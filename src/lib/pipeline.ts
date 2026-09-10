import { createHash } from "node:crypto";
import { findPerson, scout, type ScoutSignal, writeAngle } from "./agents";
import { matchPerson } from "./apollo";
import { score, strength } from "./scoring";
import { admin } from "./supabase/admin";
import { targetAccountByDomain, targetAccountRowBatches } from "./target-accounts";
import type { Account, Owner, PersonLevel } from "./types";

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

async function mapPerson(account: Account, signal: ScoutSignal) {
  const named = signal.people[0] ?? (signal.post?.author_name
    ? { name: signal.post.author_name, title: signal.post.author_title, role_in_signal: "Post author" }
    : null);
  const candidate = named
    ? { name: named.name, title: named.title, linkedin_url: null as string | null }
    : await findPerson(account.name, signal);
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
  const { data: existing } = await db.from("people").select("id,path_score,connection_owner").eq("account_id", account.id).ilike("full_name", candidate.name).maybeSingle();
  if (existing) {
    const { data, error } = await db.from("people").update(payload).eq("id", existing.id).select().single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db.from("people").insert(payload).select().single();
  if (error) throw error;
  return data;
}

async function processAccount(account: Account, runId: string, counter: { cards: number; signals: number }) {
  const db = admin();
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
  });

  for (const item of found) {
    const hash = signalHash(item.type, item.source_url);
    const { data: existing } = await db.from("signals").select("id,person_id").eq("account_id", account.id).eq("hash", hash).maybeSingle();
    const person = await mapPerson(account, item);
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
      counter.signals += 1;
    }

    if (!person || person.level === "unknown") continue;
    const scored = score({ type: item.type, level: person.level, observedAt: item.observed_at, pathScore: person.path_score, item: item.job } as never);
    const breakdown = storedBreakdown(scored);
    if (scored.score < 45) continue;

    const { data: existingCard } = await db.from("cards").select("id,status").eq("signal_id", storedId).eq("person_id", person.id).maybeSingle();
    if (existingCard) {
      await db.from("cards").update({ score: scored.score, score_breakdown: breakdown, ...(existingCard.status === "archived" ? { status: "new" } : {}) }).eq("id", existingCard.id);
      continue;
    }

    const draft = await writeAngle({ account, signal: item, person, score: scored });
    const { count } = await db.from("cards").select("*", { count: "exact", head: true });
    const assigned: Owner = person.connection_owner ?? ((count ?? 0) % 2 === 0 ? "josh" : "jenna");
    const inserted = await db.from("cards").insert({ signal_id: storedId, person_id: person.id, account_id: account.id, score: scored.score, score_breakdown: breakdown, assigned_to: assigned, ...draft }).select("id").single();
    if (inserted.error) throw inserted.error;
    counter.cards += 1;
  }

  await db.from("accounts").update({ last_scouted_at: new Date().toISOString() }).eq("id", account.id);
  await db.from("runs").update({ signals_new: counter.signals, cards_created: counter.cards }).eq("id", runId);
}

function targetPriority(account: Account) {
  const context = targetAccountByDomain.get(account.domain);
  return (context?.aiSignal ? 100 : 0) + (context?.ceo ? 25 : 0) + (context?.ownership === "PE-backed" ? 15 : 0) + Math.min(10, (context?.revenueEstimateUsdM ?? 0) / 500);
}

export async function runNightly({ accountLimit = Number(process.env.NIGHTLY_ACCOUNT_LIMIT ?? 50) }: { accountLimit?: number } = {}) {
  const db = admin();
  const safeLimit = Math.max(1, Math.min(300, Math.floor(accountLimit)));
  const { count: realAccounts } = await db.from("accounts").select("*", { count: "exact", head: true }).not("domain", "like", "%.example");
  if ((realAccounts ?? 0) === 0) {
    await db.from("accounts").delete().like("domain", "%.example");
    for (const batch of targetAccountRowBatches()) {
      const { error } = await db.from("accounts").upsert(batch, { onConflict: "domain" });
      if (error) throw error;
    }
  }

  const { data: run, error: runError } = await db.from("runs").insert({ started_at: new Date().toISOString() }).select().single();
  if (runError) throw runError;
  const cutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  const candidates: Account[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: page, error } = await db.from("accounts").select("*").eq("status", "active").or(`last_scouted_at.is.null,last_scouted_at.lt.${cutoff}`).order("name").range(from, from + pageSize - 1);
    if (error) throw error;
    candidates.push(...(page ?? []));
    if ((page?.length ?? 0) < pageSize) break;
  }
  const accounts = candidates.sort((a, b) => targetPriority(b) - targetPriority(a) || a.name.localeCompare(b.name)).slice(0, safeLimit);
  const projected = accounts.length * 0.03;
  if (projected > 10) {
    await db.from("runs").update({ finished_at: new Date().toISOString(), errors: [{ message: "Projected cost exceeds $10", projected }] }).eq("id", run.id);
    throw new Error("Nightly cost guard stopped the run");
  }

  const counter = { cards: 0, signals: 0 };
  const errors: unknown[] = [];
  for (let index = 0; index < accounts.length; index += 5) {
    await Promise.all(accounts.slice(index, index + 5).map((account) => processAccount(account, run.id, counter).catch((error) => errors.push({ account: account.domain, message: error instanceof Error ? error.message : String(error) }))));
  }
  await recomputeAndSurface();
  await db.from("runs").update({ finished_at: new Date().toISOString(), accounts_scouted: accounts.length, signals_new: counter.signals, cards_created: counter.cards, cost_usd: projected, errors }).eq("id", run.id);
  return { ...counter, accounts: accounts.length, errors };
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
    if (nextScore < 45) payload.status = "archived";
    await db.from("cards").update(payload).eq("id", card.id);
  }
  const today = new Date().toISOString().slice(0, 10);
  const { data: top } = await db.from("cards").select("id").in("status", ["new", "approved", "edited"]).or(`snooze_until.is.null,snooze_until.lte.${today}`).order("score", { ascending: false }).limit(10);
  if (top?.length) await db.from("cards").update({ surfaced_on: today }).in("id", top.map((card) => card.id));
}
