import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findPerson, scout, type ScoutSignal, writeAngle } from "./agents";
import { matchPerson } from "./apollo";
import { classifyResearchError, ResearchError, researchPreflight } from "./research-errors";
import { priorityBand, selectResearchBatch } from "./research-rotation";
import { maxCostPerAccountUsd, nightlyBatchSize, researchCooldownMs, runBudgetUsd, STALE_HEARTBEAT_MS, timeBudgetMs } from "./run-config";
import { countRows, loadRunSummary, type RunSummary } from "./run-status";
import { ARCHIVE_THRESHOLD, CARD_THRESHOLD, score, strength } from "./scoring";
import { admin } from "./supabase/admin";
import { targetAccountByDomain, targetAccountRowBatches } from "./target-accounts";
import type { Account, Owner, PersonLevel } from "./types";

type Db = SupabaseClient;

type StoredBreakdown = {
  signal_strength: number;
  person_fit: number;
  recency: number;
  relationship_path: number;
};

function normalized(url: string) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString();
}

function signalHash(type: string, url: string) {
  return createHash("sha256").update(`${type}:${normalized(url)}`).digest("hex");
}

function personLevel(title: string): PersonLevel {
  if (/\b(chief|ceo|coo|cio|cto|president|vice president|vp|head of|founder)\b/i.test(title)) return "owner";
  if (/\b(director|senior manager|sr\. manager)\b/i.test(title)) return "influencer";
  return title ? "adjacent" : "unknown";
}

function storedBreakdown(scored: ReturnType<typeof score>): StoredBreakdown {
  return {
    signal_strength: scored.breakdown.strength,
    person_fit: scored.breakdown.person_fit,
    recency: scored.breakdown.recency,
    relationship_path: scored.breakdown.path,
  };
}

/** Escape the LIKE wildcards so a name such as "Ann_Marie" matches only itself. */
function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function mapPerson(account: Account, signal: ScoutSignal, recordCost: (costUsd: number) => void) {
  const named = signal.people[0] ?? (signal.post?.author_name
    ? { name: signal.post.author_name, title: signal.post.author_title, role_in_signal: "Post author" }
    : null);
  const candidate = named
    ? { name: named.name, title: named.title, linkedin_url: null as string | null }
    : await findPerson(account.name, signal, recordCost);
  if (!candidate.name) return null;

  const apollo = await matchPerson(candidate.name, account.domain);
  const parts = candidate.name.trim().split(/\s+/);
  const title = apollo?.title ?? candidate.title;
  const payload = {
    account_id: account.id,
    full_name: candidate.name,
    first_name: apollo?.first_name ?? parts[0],
    last_name: apollo?.last_name ?? parts.slice(1).join(" "),
    title,
    level: personLevel(title),
    linkedin_url: apollo?.linkedin_url ?? candidate.linkedin_url,
    email: apollo?.email ?? null,
    email_status: apollo?.email_status === "verified" ? "verified" : apollo?.email_status === "catch_all" ? "catch_all" : apollo ? "unverified" : "none",
    email_source: apollo ? "apollo" : null,
    email_verified_at: apollo?.email_status === "verified" ? new Date().toISOString() : null,
  };
  const db = admin();
  // people has a unique index on (account_id, lower(full_name)); take the first
  // match rather than maybeSingle() so an unexpected duplicate cannot fail the company.
  const findExisting = () => db.from("people").select("id,path_score,connection_owner").eq("account_id", account.id).ilike("full_name", likeLiteral(candidate.name)).order("created_at").limit(1);
  const { data: matches } = await findExisting();
  const existing = matches?.[0];
  if (existing) {
    const { data, error } = await db.from("people").update(payload).eq("id", existing.id).select().single();
    if (error) throw error;
    return data;
  }
  const inserted = await db.from("people").insert(payload).select().single();
  if (inserted.error?.code === "23505") {
    // Raced with another writer on the unique index: update the row that won.
    const { data: winner } = await findExisting();
    if (winner?.[0]) {
      const { data, error } = await db.from("people").update(payload).eq("id", winner[0].id).select().single();
      if (error) throw error;
      return data;
    }
  }
  if (inserted.error) throw inserted.error;
  return inserted.data;
}

export type AccountOutcome = {
  signalsFound: number;
  signalsKept: number;
  signalsNew: number;
  cardsCreated: number;
  costUsd: number;
  model: string | null;
};

/**
 * Research one company. Never stamps last_scouted_at itself; the caller does
 * that on success only, so a failed company stays eligible for retry.
 */
export async function processAccount(account: Account): Promise<AccountOutcome> {
  const db = admin();
  const outcome: AccountOutcome = { signalsFound: 0, signalsKept: 0, signalsNew: 0, cardsCreated: 0, costUsd: 0, model: null };
  const recordCost = (costUsd: number) => { outcome.costUsd += costUsd; };
  const context = targetAccountByDomain.get(account.domain);
  const found = await scout({
    ...account,
    researchContext: context ? {
      aiSignal: context.aiSignal,
      sourceUrl: context.sourceUrl,
      ceo: context.ceo,
      buyerTitles: context.targetTitles,
      revenueBand: context.revenueBand,
      subSegment: context.subSegment,
    } : undefined,
  }, recordCost);
  outcome.signalsFound = found.found;
  outcome.signalsKept = found.kept;
  outcome.model = found.model;

  for (const item of found.signals) {
    const hash = signalHash(item.type, item.source_url);
    const { data: existing } = await db.from("signals").select("id,person_id").eq("account_id", account.id).eq("hash", hash).maybeSingle();
    const person = await mapPerson(account, item, recordCost);
    const signalPayload = {
      account_id: account.id,
      person_id: person?.id ?? null,
      type: item.type,
      summary: item.summary,
      source_url: normalized(item.source_url),
      source_domain: new URL(item.source_url).hostname,
      observed_at: item.observed_at,
      raw: item,
      hash,
      strength: strength(item.type, item.job),
      modifiers: item.job ?? {},
    };

    let storedId: string;
    if (existing) {
      const { error } = await db.from("signals").update(signalPayload).eq("id", existing.id);
      if (error) throw error;
      storedId = existing.id;
    } else {
      const { data: stored, error } = await db.from("signals").insert(signalPayload).select("id").single();
      if (error) throw error;
      storedId = stored.id;
      outcome.signalsNew += 1;
    }

    if (!person || person.level === "unknown") continue;
    const scored = score({ type: item.type, level: person.level, observedAt: item.observed_at, pathScore: person.path_score, item: item.job } as never);
    const breakdown = storedBreakdown(scored);
    if (scored.score < CARD_THRESHOLD) continue;

    const { data: existingCard } = await db.from("cards").select("id,status").eq("signal_id", storedId).eq("person_id", person.id).maybeSingle();
    if (existingCard) {
      await db.from("cards").update({ score: scored.score, score_breakdown: breakdown, ...(existingCard.status === "archived" ? { status: "new" } : {}) }).eq("id", existingCard.id);
      continue;
    }

    const draft = await writeAngle({ account, signal: item, person, score: scored }, recordCost);
    const { count } = await db.from("cards").select("*", { count: "exact", head: true });
    const assigned: Owner = person.connection_owner ?? ((count ?? 0) % 2 === 0 ? "josh" : "jenna");
    const inserted = await db.from("cards").insert({ signal_id: storedId, person_id: person.id, account_id: account.id, score: scored.score, score_breakdown: breakdown, assigned_to: assigned, ...draft }).select("id").single();
    if (inserted.error) throw inserted.error;
    outcome.cardsCreated += 1;
  }
  return outcome;
}

async function ensureAccountsLoaded(db: Db) {
  const { count: realAccounts } = await db.from("accounts").select("*", { count: "exact", head: true }).not("domain", "like", "%.example");
  if ((realAccounts ?? 0) > 0) return;
  await db.from("accounts").delete().like("domain", "%.example");
  for (const batch of targetAccountRowBatches()) {
    const { error } = await db.from("accounts").upsert(batch, { onConflict: "domain" });
    if (error) throw error;
  }
}

async function allActiveAccounts(db: Db) {
  const accounts: Account[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await db.from("accounts").select("*").eq("status", "active").not("domain", "like", "%.example").order("name").range(from, from + pageSize - 1);
    if (error) throw error;
    accounts.push(...((page ?? []) as Account[]));
    if ((page?.length ?? 0) < pageSize) break;
  }
  return accounts;
}

/**
 * Companies already queued or running in an open run are not enqueued again,
 * so a manual run and the scheduled run never research the same company twice.
 */
async function accountIdsInOpenRuns(db: Db) {
  const { data: openRuns } = await db.from("runs").select("id").eq("status", "open");
  const ids = (openRuns ?? []).map((run) => run.id);
  if (!ids.length) return new Set<string>();
  const { data } = await db.from("run_accounts").select("account_id").in("run_id", ids).in("status", ["queued", "running"]);
  return new Set((data ?? []).map((row) => row.account_id as string));
}

/**
 * A run whose heartbeat has gone quiet was cut off by its execution window.
 * Its in-flight company is recorded as a timeout, queued companies stay
 * queued for the next invocation, and a run with nothing left is closed.
 * A run with a fresh heartbeat is never touched: it belongs to someone else.
 */
async function sweepStaleRuns(db: Db, now: number) {
  const cutoff = new Date(now - STALE_HEARTBEAT_MS).toISOString();
  const { data: stale } = await db.from("runs").select("id,heartbeat_at,started_at").eq("status", "open").or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`);
  for (const run of stale ?? []) {
    if (!run.heartbeat_at && Date.parse(run.started_at) > now - STALE_HEARTBEAT_MS) continue;
    await db.from("run_accounts").update({
      status: "error",
      error_code: "timeout",
      error_message: "The execution window ended while this company was being researched. It was not marked as researched and will be retried.",
      finished_at: new Date(now).toISOString(),
    }).eq("run_id", run.id).eq("status", "running");
    const { count: queued } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", run.id).eq("status", "queued");
    if ((queued ?? 0) === 0) await finalizeRun(db, run.id, "complete", now);
  }
}

async function refreshRunAggregates(db: Db, runId: string, now: number) {
  const { data: rows } = await db.from("run_accounts").select("status,signals_new,cards_created,cost_usd,domain,error_code,error_message").eq("run_id", runId);
  const list = rows ?? [];
  const errors = list
    .filter((row) => row.status === "error")
    .map((row) => ({ account: row.domain, code: row.error_code ?? "unknown", message: row.error_message ?? "Research failed" }));
  await db.from("runs").update({
    accounts_scouted: list.filter((row) => ["ok", "no_signal", "error"].includes(row.status)).length,
    signals_new: list.reduce((sum, row) => sum + Number(row.signals_new ?? 0), 0),
    cards_created: list.reduce((sum, row) => sum + Number(row.cards_created ?? 0), 0),
    cost_usd: Number(list.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0).toFixed(6)),
    errors,
    heartbeat_at: new Date(now).toISOString(),
  }).eq("id", runId);
}

async function finalizeRun(db: Db, runId: string, status: "complete" | "cancelled", now: number) {
  await db.from("run_accounts").update({ status: "cancelled", finished_at: new Date(now).toISOString() }).eq("run_id", runId).eq("status", "queued");
  await refreshRunAggregates(db, runId, now);
  const notes: Array<{ stage: string; message: string }> = [];
  try {
    await recomputeAndSurface();
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] recomputeAndSurface failed for run ${runId} (${classified.code}): ${classified.message}`);
    notes.push({ stage: "surface", message: classified.message });
  }
  if (notes.length) {
    const { data: run } = await db.from("runs").select("errors").eq("id", runId).single();
    await db.from("runs").update({ errors: [...(Array.isArray(run?.errors) ? run.errors : []), ...notes] }).eq("id", runId);
  }
  await db.from("runs").update({ status, finished_at: new Date(now).toISOString() }).eq("id", runId);
}

export type RunSource = "scheduled" | "manual";

export type RunNightlyOptions = {
  source: RunSource;
  /** Continue this open run instead of creating one. */
  runId?: string;
  /** Companies to enqueue when creating a run. Defaults to the configured batch size. */
  accountLimit?: number;
  /** Enqueue exactly these accounts, ignoring the cooldown. Used to retry failures. */
  accountIds?: string[];
  /** Milliseconds this invocation may spend before returning with the run still open. */
  timeBudgetMs?: number;
  now?: () => number;
};

export type StopReason = "finished" | "cancelled" | "time_budget" | "cost_budget" | "already_closed" | "busy";

export type RunNightlyResult = {
  run: RunSummary;
  /** Why this invocation returned. Only `finished` and `cancelled` close the run. */
  stopped: StopReason;
  /** Companies processed in this invocation. */
  processed: number;
  invocationCostUsd: number;
  projectedMaxCostUsd: number;
};

async function createRun(db: Db, options: RunNightlyOptions, now: number) {
  const limit = Math.max(1, Math.min(300, Math.floor(options.accountLimit ?? nightlyBatchSize())));
  const accounts = await allActiveAccounts(db);
  const busy = await accountIdsInOpenRuns(db);
  let batch: Account[];
  if (options.accountIds?.length) {
    const wanted = new Set(options.accountIds);
    batch = accounts.filter((account) => wanted.has(account.id) && !busy.has(account.id));
  } else {
    batch = selectResearchBatch(
      accounts.filter((account) => !busy.has(account.id)),
      { limit, cooldownMs: researchCooldownMs(), now, bandOf: (account) => priorityBand(targetAccountByDomain.get(account.domain)) },
    );
  }
  const { data: run, error } = await db.from("runs").insert({
    started_at: new Date(now).toISOString(),
    heartbeat_at: new Date(now).toISOString(),
    status: "open",
    source: options.source,
    requested_accounts: batch.length,
  }).select("id").single();
  if (error) throw error;
  if (batch.length) {
    const { error: rowsError } = await db.from("run_accounts").insert(batch.map((account, index) => ({
      run_id: run.id,
      account_id: account.id,
      position: index + 1,
      domain: account.domain,
      name: account.name,
    })));
    if (rowsError) throw rowsError;
  }
  return run.id as string;
}

/**
 * Create or continue a research run and work it until it finishes, the
 * caller's time budget is spent, the invocation's cost budget is reached, or
 * a stop is requested. A run that outlives its window stays open with its
 * remaining companies queued; the next invocation picks it up.
 */
export async function runNightly(options: RunNightlyOptions): Promise<RunNightlyResult> {
  researchPreflight();
  const db = admin();
  const clock = options.now ?? Date.now;
  const started = clock();
  const budget = options.timeBudgetMs ?? timeBudgetMs(options.source);
  const costBudget = runBudgetUsd();

  await sweepStaleRuns(db, started);
  await ensureAccountsLoaded(db);

  let runId = options.runId ?? null;
  if (runId) {
    const { data: run } = await db.from("runs").select("id,status,heartbeat_at").eq("id", runId).maybeSingle();
    if (!run) throw new ResearchError("unknown", "That research run does not exist.");
    if (run.status !== "open") return summarize(db, runId, "already_closed", 0, 0);
  } else if (options.source === "scheduled" && !options.accountIds?.length) {
    // Resume an idle open run before starting a new one, so a batch that
    // outlived last night's window is finished before the list advances.
    const idleCutoff = new Date(started - 2 * 60_000).toISOString();
    const { data: idle } = await db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false)
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${idleCutoff}`).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (idle) {
      const { count } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", idle.id).eq("status", "queued");
      if ((count ?? 0) > 0) runId = idle.id;
    }
  }
  if (!runId) runId = await createRun(db, options, started);

  await db.from("runs").update({ heartbeat_at: new Date(started).toISOString() }).eq("id", runId);

  let processed = 0;
  let invocationCost = 0;
  let stopped: StopReason = "finished";

  for (;;) {
    const now = clock();
    if (now - started >= budget) { stopped = "time_budget"; break; }
    if (invocationCost >= costBudget) { stopped = "cost_budget"; break; }

    const { data: fresh } = await db.from("runs").select("cancel_requested,status").eq("id", runId).single();
    if (fresh?.status !== "open") { stopped = "already_closed"; break; }
    if (fresh.cancel_requested) { stopped = "cancelled"; break; }

    const { data: next } = await db.from("run_accounts").select("id,account_id,domain").eq("run_id", runId).eq("status", "queued").order("position").limit(1).maybeSingle();
    if (!next) { stopped = "finished"; break; }
    const { data: claimed } = await db.from("run_accounts").update({ status: "running", started_at: new Date(now).toISOString() })
      .eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
    if (!claimed) continue;

    const { data: account } = await db.from("accounts").select("*").eq("id", next.account_id).maybeSingle();
    const rowStart = clock();
    let update: Record<string, unknown>;
    try {
      if (!account) throw new ResearchError("db_error", `Account ${next.domain} no longer exists.`);
      const outcome = await processAccount(account as Account);
      invocationCost += outcome.costUsd;
      const { error: stampError } = await db.from("accounts").update({ last_scouted_at: new Date(clock()).toISOString() }).eq("id", account.id);
      if (stampError) throw stampError;
      update = {
        status: outcome.signalsKept > 0 ? "ok" : "no_signal",
        signals_found: outcome.signalsFound,
        signals_kept: outcome.signalsKept,
        signals_new: outcome.signalsNew,
        cards_created: outcome.cardsCreated,
        cost_usd: Number(outcome.costUsd.toFixed(6)),
        model: outcome.model,
        error_code: null,
        error_message: null,
      };
    } catch (error) {
      const classified = classifyResearchError(error);
      console.error(`[night-watch] research failed for ${next.domain} (${classified.code}): ${classified.message}`);
      update = { status: "error", error_code: classified.code, error_message: classified.message };
    }
    const finishedAt = clock();
    await db.from("run_accounts").update({ ...update, finished_at: new Date(finishedAt).toISOString(), duration_ms: finishedAt - rowStart }).eq("id", next.id);
    processed += 1;
    await refreshRunAggregates(db, runId, finishedAt);
  }

  const ended = clock();
  if (stopped === "finished" || stopped === "cancelled") {
    await finalizeRun(db, runId, stopped === "cancelled" ? "cancelled" : "complete", ended);
  } else if (stopped !== "already_closed") {
    await refreshRunAggregates(db, runId, ended);
  }
  const { data: current } = await db.from("runs").select("invocations").eq("id", runId).single();
  await db.from("runs").update({ invocations: Number(current?.invocations ?? 0) + 1 }).eq("id", runId);
  return summarize(db, runId, stopped, processed, invocationCost);
}

async function summarize(db: Db, runId: string, stopped: StopReason, processed: number, invocationCost: number): Promise<RunNightlyResult> {
  const run = await loadRunSummary(db, runId);
  if (!run) throw new ResearchError("db_error", "The run record disappeared while it was being processed.");
  return {
    run: { ...run, counts: countRows(run.rows, run.counts.requested) },
    stopped,
    processed,
    invocationCostUsd: Number(invocationCost.toFixed(6)),
    projectedMaxCostUsd: Number((run.counts.requested * maxCostPerAccountUsd()).toFixed(2)),
  };
}

/** Ask a run to stop after the company in progress. Closes it at once when nothing is running. */
export async function cancelRun(runId: string) {
  const db = admin();
  const now = Date.now();
  const { data: run } = await db.from("runs").select("id,status").eq("id", runId).maybeSingle();
  if (!run) throw new ResearchError("unknown", "That research run does not exist.");
  if (run.status !== "open") return loadRunSummary(db, runId);
  await db.from("runs").update({ cancel_requested: true }).eq("id", runId);
  const { count: running } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", runId).eq("status", "running");
  if ((running ?? 0) === 0) await finalizeRun(db, runId, "cancelled", now);
  return loadRunSummary(db, runId);
}

function normalizeStoredBreakdown(value: unknown): StoredBreakdown {
  const current = value as Partial<StoredBreakdown> & { breakdown?: { strength?: number; person_fit?: number; recency?: number; path?: number } };
  return {
    signal_strength: current.signal_strength ?? current.breakdown?.strength ?? 0,
    person_fit: current.person_fit ?? current.breakdown?.person_fit ?? 0,
    recency: current.recency ?? current.breakdown?.recency ?? 0,
    relationship_path: current.relationship_path ?? current.breakdown?.path ?? 0,
  };
}

/**
 * Re-score every open card for recency, archive the ones that decayed below
 * the archive threshold, and stamp today's top ten as surfaced. Runs once per
 * run, when the run closes; never per company.
 */
export async function recomputeAndSurface() {
  const db = admin();
  const { data: cards } = await db.from("cards").select("id,score_breakdown,signals(observed_at)").in("status", ["new", "approved", "edited", "snoozed"]);
  for (const card of cards ?? []) {
    const observedAt = (card.signals as unknown as { observed_at: string }).observed_at;
    const prior = normalizeStoredBreakdown(card.score_breakdown);
    const nextRecency = score({ type: "other", level: "unknown", observedAt, pathScore: 0 }).breakdown.recency;
    const nextBreakdown = { ...prior, recency: nextRecency };
    const nextScore = Object.values(nextBreakdown).reduce((sum, value) => sum + value, 0);
    const payload: { score: number; score_breakdown: StoredBreakdown; status?: "archived" } = { score: nextScore, score_breakdown: nextBreakdown };
    if (nextScore < ARCHIVE_THRESHOLD) payload.status = "archived";
    await db.from("cards").update(payload).eq("id", card.id);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: top } = await db.from("cards").select("id").in("status", ["new", "approved", "edited"]).or(`snooze_until.is.null,snooze_until.lte.${today}`).order("score", { ascending: false }).limit(10);
  if (top?.length) await db.from("cards").update({ surfaced_on: today }).in("id", top.map((card) => card.id));
}
