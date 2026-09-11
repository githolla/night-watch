import { disqualifySignal } from "./agents.ts";
import { analyzeCompany, type AnalysisInput, type CompanyAnalysis } from "./analysis.ts";
import { fillEmailsFromPattern } from "./email-fill.ts";
import { FAMILY_LABEL, type JobFamily } from "./job-sweep/classify.ts";
import { recomputeAccountIntel } from "./account-intel.ts";
import {
  accountIdsInOpenRuns, ensureAccountsLoaded, finalizeRun, persistSignal, refreshRunAggregates, summarize, sweepStaleRuns, upsertPerson,
  type AccountOutcome, type RunNightlyResult, type StopReason,
} from "./pipeline.ts";
import { classifyResearchError, ResearchError, researchPreflight } from "./research-errors.ts";
import { analysisConfig, timeBudgetMs } from "./run-config.ts";
import { requireSchema } from "./schema-check.ts";
import { admin } from "./supabase/admin.ts";
import { targetAccountByDomain } from "./target-accounts.ts";
import type { Account } from "./types.ts";

type Db = ReturnType<typeof admin>;
export type AnalysisSource = "analysis" | "analysis_manual";
export type AnalysisOptions = {
  source: AnalysisSource;
  runId?: string;
  accountLimit?: number;
  accountIds?: string[];
  /** Analyse everyone on the list, cooldown or not. */
  force?: boolean;
  resumeIdle?: boolean;
  timeBudgetMs?: number;
  now?: () => number;
};

/** Analyse one company and store everything it produced: people, addresses, voices, signals and the brief. */
export async function analyzeAndStore(db: Db, account: Account, recordCost: (cost: number) => void, outcome: AccountOutcome): Promise<CompanyAnalysis> {
  const config = analysisConfig();
  const target = targetAccountByDomain.get(account.domain);
  const [{ data: roles }, { data: people }, { data: posts }] = await Promise.all([
    db.from("job_postings").select("title,family,url").eq("account_id", account.id).eq("active", true).not("family", "is", null).limit(30),
    db.from("people").select("full_name,title").eq("account_id", account.id).eq("do_not_contact", false).limit(40),
    db.from("public_posts").select("author_name,excerpt,url").eq("account_id", account.id).limit(10),
  ]);
  const input: AnalysisInput = {
    name: account.name, domain: account.domain,
    industry: target?.vertical ?? account.vertical ?? "", subSegment: target?.subSegment ?? "", hq: [target?.hqCity, target?.hqState].filter(Boolean).join(", "),
    ownership: target?.ownership ?? "", revenueBand: target?.revenueBand ?? "", employees: target?.employees ?? null, ceo: target?.ceo ?? "",
    buyerTitles: target?.targetTitles ?? account.target_titles ?? [], aiSignalOnFile: target?.aiSignal ?? "", fileNotes: target?.notes ?? "",
    rolesOnFile: (roles ?? []).map((role) => ({ title: role.title as string, family: FAMILY_LABEL[role.family as JobFamily] ?? String(role.family), url: role.url as string })),
    peopleOnFile: (people ?? []).map((person) => ({ name: person.full_name as string, title: person.title as string })),
    postsOnFile: (posts ?? []).map((post) => ({ author: post.author_name as string, excerpt: post.excerpt as string, url: post.url as string })),
  };
  let cost = 0;
  const record = (value: number) => { cost += value; recordCost(value); };
  const analysis = await analyzeCompany(input, { model: config.model, searches: config.searches }, record);
  analysis.costUsd = Number(cost.toFixed(6));

  for (const person of analysis.people) {
    try { await upsertPerson(account, { name: person.name, title: person.title, linkedin_url: person.linkedin_url }, "analysis"); }
    catch (error) { analysis.problems.push(`could not store ${person.name}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const voice of analysis.voices) {
    if (!/^https?:\/\//.test(voice.url)) continue;
    const postedAt = voice.date && /^\d{4}-\d{2}-\d{2}/.test(voice.date) ? voice.date.slice(0, 10) : null;
    const { error } = await db.from("public_posts").upsert({
      account_id: account.id, author_name: voice.author, author_title: voice.title, url: voice.url, platform: voice.platform, topic: voice.topic,
      excerpt: voice.quote, posted_at: postedAt, found_by: `analysis:${config.model}`, raw: voice,
    }, { onConflict: "account_id,url" });
    if (error) analysis.problems.push(`could not store a quote: ${error.message}`);
  }
  try { await fillEmailsFromPattern(db, account, analysis.emailExamples); } catch (error) { analysis.problems.push(`email pattern: ${error instanceof Error ? error.message : String(error)}`); }
  for (const signal of analysis.signals) {
    const reason = disqualifySignal(signal);
    if (reason) { analysis.problems.push(`signal not kept: ${reason}`); continue; }
    outcome.signalsFound += 1;
    try { await persistSignal(account, signal, outcome, record); outcome.signalsKept += 1; }
    catch (error) { analysis.problems.push(`signal not stored: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const { error } = await db.from("accounts").update({ analysis, analysis_at: analysis.analyzedAt, analysis_model: config.model, analysis_cost_usd: analysis.costUsd }).eq("id", account.id);
  if (error) throw error;
  return analysis;
}

async function selectAccounts(db: Db, options: AnalysisOptions, now: number) {
  const busy = await accountIdsInOpenRuns(db);
  if (options.accountIds?.length) {
    const { data } = await db.from("accounts").select("id,name,domain").in("id", options.accountIds).eq("status", "active");
    return (data ?? []).filter((account) => !busy.has(account.id));
  }
  const limit = Math.max(1, Math.min(2000, Math.floor(options.accountLimit ?? 2000)));
  const cutoff = new Date(now - analysisConfig().cooldownMs).toISOString();
  let query = db.from("accounts").select("id,name,domain").eq("status", "active").eq("outreach", true).not("domain", "like", "%.example");
  if (!options.force) query = query.or(`analysis_at.is.null,analysis_at.lt.${cutoff}`);
  // The hottest companies first: most on file, then never analysed, then oldest analysis.
  const { data, error } = await query.order("intel_score", { ascending: false }).order("analysis_at", { ascending: true, nullsFirst: true }).order("name").limit(limit + busy.size);
  if (error) throw error;
  return (data ?? []).filter((account) => !busy.has(account.id)).slice(0, limit);
}

/**
 * Analyse a batch of reach-out companies with the agent swarm. Same run
 * record, time budget, cost budget and stop handling as the other runs.
 */
export async function runAnalysis(options: AnalysisOptions): Promise<RunNightlyResult> {
  researchPreflight();
  const db = admin();
  await requireSchema(db);
  const clock = options.now ?? Date.now;
  const started = clock();
  const budget = options.timeBudgetMs ?? timeBudgetMs(options.source === "analysis" ? "scheduled" : "manual");
  const config = analysisConfig();

  await sweepStaleRuns(db, started);
  await ensureAccountsLoaded(db);

  let runId = options.runId ?? null;
  if (runId) {
    const { data: run } = await db.from("runs").select("id,status").eq("id", runId).maybeSingle();
    if (!run) throw new ResearchError("unknown", "That analysis run does not exist.");
    if (run.status !== "open") return summarize(db, runId, "already_closed", 0, 0);
  } else if ((options.source === "analysis" || options.resumeIdle) && !options.accountIds?.length) {
    const idleCutoff = new Date(started - 2 * 60_000).toISOString();
    const { data: idle } = await db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).in("source", ["analysis", "analysis_manual"])
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${idleCutoff}`).order("started_at", { ascending: false }).limit(1).maybeSingle();
    if (idle) {
      const { count } = await db.from("run_accounts").select("*", { count: "exact", head: true }).eq("run_id", idle.id).eq("status", "queued");
      if ((count ?? 0) > 0) runId = idle.id;
    }
  }
  if (!runId) {
    const batch = await selectAccounts(db, options, started);
    const { data: run, error } = await db.from("runs").insert({ started_at: new Date(started).toISOString(), heartbeat_at: new Date(started).toISOString(), status: "open", source: options.source, requested_accounts: batch.length }).select("id").single();
    if (error) throw error;
    if (batch.length) {
      const { error: rowsError } = await db.from("run_accounts").insert(batch.map((account, index) => ({ run_id: run.id, account_id: account.id, position: index + 1, domain: account.domain, name: account.name })));
      if (rowsError) throw rowsError;
    }
    runId = run.id as string;
  }
  const id = runId;
  await db.from("runs").update({ heartbeat_at: new Date(started).toISOString() }).eq("id", id);

  let processed = 0;
  let invocationCost = 0;
  const state: { stopped: StopReason; halt: boolean } = { stopped: "finished", halt: false };

  const worker = async () => {
    while (!state.halt) {
      const now = clock();
      if (now - started >= budget) { state.stopped = "time_budget"; state.halt = true; break; }
      if (invocationCost >= config.budgetUsd) { state.stopped = "cost_budget"; state.halt = true; break; }
      const { data: fresh } = await db.from("runs").select("cancel_requested,status").eq("id", id).single();
      if (fresh?.status !== "open") { state.stopped = "already_closed"; state.halt = true; break; }
      if (fresh.cancel_requested) { state.stopped = "cancelled"; state.halt = true; break; }
      const { data: next } = await db.from("run_accounts").select("id,account_id,domain").eq("run_id", id).eq("status", "queued").order("position").limit(1).maybeSingle();
      if (!next) break;
      const { data: claimed } = await db.from("run_accounts").update({ status: "running", started_at: new Date(now).toISOString() }).eq("id", next.id).eq("status", "queued").select("id").maybeSingle();
      if (!claimed) continue;
      const rowStart = clock();
      let update: Record<string, unknown>;
      const outcome: AccountOutcome = { signalsFound: 0, signalsKept: 0, signalsNew: 0, cardsCreated: 0, costUsd: 0, model: config.model };
      try {
        const { data: account } = await db.from("accounts").select("*").eq("id", next.account_id).maybeSingle();
        if (!account) throw new ResearchError("db_error", `Account ${next.domain} no longer exists.`);
        const analysis = await analyzeAndStore(db, account as Account, (cost) => { outcome.costUsd += cost; invocationCost += cost; }, outcome);
        const parts = [
          `fit ${analysis.brief.fit}`,
          analysis.people.length ? `${analysis.people.length} people` : null,
          analysis.voices.length ? `${analysis.voices.length} quotes` : null,
          analysis.hiring.roles.length ? `${analysis.hiring.roles.length} roles read` : null,
          outcome.signalsKept ? `${outcome.signalsKept} signals` : null,
          outcome.cardsCreated ? `${outcome.cardsCreated} drafts` : null,
          analysis.problems.length ? `${analysis.problems.length} problems` : null,
        ].filter(Boolean);
        update = {
          status: analysis.brief.fit >= 40 || outcome.signalsKept ? "ok" : "no_signal",
          signals_found: outcome.signalsFound, signals_kept: outcome.signalsKept, signals_new: outcome.signalsNew, cards_created: outcome.cardsCreated,
          cost_usd: Number(outcome.costUsd.toFixed(6)), model: config.model, error_code: null, error_message: null, note: parts.join(" · "),
        };
      } catch (error) {
        const classified = classifyResearchError(error);
        console.error(`[night-watch] analysis failed for ${next.domain} (${classified.code}): ${classified.message}`);
        update = { status: "error", error_code: classified.code, error_message: classified.message, cost_usd: Number(outcome.costUsd.toFixed(6)) };
      }
      const finishedAt = clock();
      await db.from("run_accounts").update({ ...update, finished_at: new Date(finishedAt).toISOString(), duration_ms: finishedAt - rowStart }).eq("id", next.id);
      processed += 1;
      await recomputeAccountIntel(db, next.account_id, new Date(finishedAt)).catch(() => undefined);
      await refreshRunAggregates(db, id, finishedAt);
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const ended = clock();
  const { stopped } = state;
  if (stopped === "finished" || stopped === "cancelled") await finalizeRun(db, id, stopped === "cancelled" ? "cancelled" : "complete", ended);
  else if (stopped !== "already_closed") await refreshRunAggregates(db, id, ended);
  return summarize(db, id, stopped, processed, invocationCost);
}
