import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listOutcomes, priorScore, sectorWeights, type OutcomeTouch } from "./ai-fit.ts";
import { researchBudget, withBudget } from "./anthropic-cost.ts";
import { runSearchAgent } from "./agents.ts";
import { allFocus } from "./focus-data.ts";
import { localParts } from "./local-time.ts";
import { sectorsForNight } from "./list-sectors.ts";
import { researchModel } from "./models.ts";
import { autoSendBlocker, isSendDay } from "./morning-send-rules.ts";
import {
  ABORT_AT_MS, autoSendable, canStartBatch, committedSpend, failureReason, minedHosts, NEUTRAL_SECTOR_RANK, nextSourcingAction, normalizeCompanyName,
  pastFinalizeDeadline, rankForList, reclaimStatus, REQUEUE_AFTER_DAYS, REQUEUE_PRIOR_PENALTY, sectorKeyFor, shouldRequeue, slotsWithinBudget, sourcingAttempts,
  sourcingPrompt, START_CUTOFF_MS, UNCONFIRMED_PRIOR_PENALTY,
} from "./nightly-list-rules.ts";
import { loadNightlyLists } from "./nightly-lists.ts";
import { onDomain, safeFetch, type Fetcher, type SeenSource } from "./evidence-grounding.ts";
import { isExcludedSector, researchOne, type Candidate, type ResearchDeps, type ResearchResult } from "./nightly-research.ts";
import { preparePriorityDraft } from "./prepare-priority-draft.ts";
import { domainAcceptsMail, recordRecipientCheck, type RecipientCheck, type RecipientPerson } from "./recipient-verification.ts";
import type { ListOffer, ListRow } from "./research-data/server.ts";
import { verifySite } from "./site-check.ts";
import type { Owner } from "./types.ts";

type Db = SupabaseClient;

/** Tunables. Defaults: 12 a day each, chosen by AI fit from 20 evaluated per person, $10 a night. */
export function nightlyListConfig() {
  const num = (name: string, fallback: number, min: number, max: number) => {
    const value = Number(process.env[name] ?? fallback);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  };
  return {
    size: Math.floor(num("NIGHTLY_LIST_SIZE", 12, 1, 25)),
    research: Math.floor(num("NIGHTLY_LIST_RESEARCH", 20, 1, 40)),
    /** Lowest AI-fit score (0 to 100) that may go on a list. */
    minFit: Math.floor(num("NIGHTLY_LIST_MIN_FIT", 40, 0, 100)),
    /** How long a well-scoring runner-up may fill a later list without being researched again. */
    reserveDays: Math.floor(num("NIGHTLY_LIST_RESERVE_DAYS", 14, 0, 60)),
    budgetUsd: num("NIGHTLY_LIST_BUDGET_USD", 10, 0.5, 50),
    maxCostPerCompanyUsd: num("NIGHTLY_LIST_MAX_COST_PER_COMPANY_USD", 0.5, 0.05, 2),
    searchesPerCompany: Math.floor(num("ANTHROPIC_MAX_SEARCHES_PER_COMPANY", 3, 1, 5)),
    sourcingSearches: Math.floor(num("NIGHTLY_LIST_SOURCING_SEARCHES", 5, 1, 10)),
    concurrency: Math.floor(num("NIGHTLY_LIST_CONCURRENCY", 3, 1, 6)),
  };
}

export const LIST_OWNERS: Owner[] = ["josh", "suuchi"];
const ownerKey = (owner: Owner) => (owner === "josh" ? "josh" : "suuchi");
const domainOf = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
const validDomain = (domain: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const money = (value: number) => Number(value.toFixed(6));
const STALE_CLAIM_MS = 15 * 60_000;

const sourcedCompany = z.object({
  company: z.string().min(2), domain: z.string().min(4), sector: z.string().default("").catch(""), sectorNumber: z.number().int().nullable().default(null).catch(null),
  revenueUsdM: z.number().nullable().default(null).catch(null), revenueYear: z.number().int().nullable().default(null).catch(null), sourceUrl: z.string().url().nullable(),
  locations: z.number().int().nonnegative().nullable().default(null).catch(null), fieldService: z.boolean().nullable().default(null).catch(null),
});
const sourced = z.object({ companies: z.array(z.unknown()).default([]) });

/** A finished list row kept for a later night: the row, its versions and its address check. */
type Prepared = { row: ListRow; offer: ListOffer };
type ListRecord = { id: string; list_date: string; owner: Owner; status: string; rows: ListRow[]; offers: ListOffer[]; attempts: number; cost_usd: number; errors: unknown[] };
type Queued = Candidate & { research_attempts?: number | null; cost_usd?: number | null };
/** Domains and normalised names of client and do-not-contact accounts, checked again just before research. */
type Blocked = { domains: Set<string>; names: Set<string> };

const LIST_COLUMNS = "id,list_date,owner,status,rows,offers,attempts,cost_usd,errors";
const toRecord = (row: Record<string, unknown>) => ({ ...row, rows: (row.rows ?? []) as ListRow[], offers: (row.offers ?? []) as ListOffer[], attempts: Number(row.attempts ?? 0), cost_usd: Number(row.cost_usd ?? 0), errors: (row.errors ?? []) as unknown[] }) as ListRecord;

async function loadLists(db: Db, listDate: string): Promise<ListRecord[]> {
  const { data, error } = await db.from("reachout_lists").select(LIST_COLUMNS).eq("list_date", listDate);
  if (error) throw new Error(`Could not read tonight's lists: ${error.message}`);
  return (data ?? []).map((row) => toRecord(row as Record<string, unknown>));
}

/**
 * Serialised read-and-write of one list row per invocation. Research tasks finish in any order and each
 * saves as soon as it resolves, so without this two of them could read the same row and one update be lost.
 */
function listWriter(db: Db) {
  const chains = new Map<string, Promise<unknown>>();
  return (listId: string, change: (list: ListRecord) => Record<string, unknown> | null): Promise<ListRecord | null> => {
    const run = async () => {
      const { data, error } = await db.from("reachout_lists").select(LIST_COLUMNS).eq("id", listId).maybeSingle();
      if (error) throw new Error(`Could not read list ${listId}: ${error.message}`);
      if (!data) return null;
      const fresh = toRecord(data as Record<string, unknown>);
      const patch = change(fresh);
      if (!patch) return fresh;
      const { error: writeError } = await db.from("reachout_lists").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", listId);
      if (writeError) throw new Error(`Could not save list ${listId}: ${writeError.message}`);
      return fresh;
    };
    const next = (chains.get(listId) ?? Promise.resolve()).catch(() => undefined).then(run);
    chains.set(listId, next);
    return next;
  };
}
type ListWrite = ReturnType<typeof listWriter>;

/** Companies already handled anywhere: curated files, earlier nightly candidates, or excluded or contacted accounts. */
async function knownCompanies(db: Db): Promise<{ domains: Set<string>; names: Set<string> }> {
  const domains = new Set(allFocus().map((row) => domainOf(row.domain)));
  const names = new Set<string>();
  const [{ data: candidates }, { data: blocked }, { data: touched }] = await Promise.all([
    db.from("list_candidates").select("domain").limit(20000),
    db.from("accounts").select("domain,name").in("status", ["client", "do_not_contact"]).limit(20000),
    db.from("touches").select("cards(accounts(domain))").limit(20000),
  ]);
  for (const row of candidates ?? []) domains.add(domainOf(row.domain as string));
  for (const row of blocked ?? []) {
    if (row.domain) domains.add(domainOf(row.domain as string));
    const name = normalizeCompanyName(String(row.name ?? ""));
    if (name) names.add(name);
  }
  for (const row of touched ?? []) {
    const domain = (row.cards as unknown as { accounts: { domain: string } | null } | null)?.accounts?.domain;
    if (domain) domains.add(domainOf(domain));
  }
  return { domains, names };
}

async function blockedAccounts(db: Db): Promise<Blocked> {
  const { data } = await db.from("accounts").select("domain,name").in("status", ["client", "do_not_contact"]).limit(20000);
  const blocked: Blocked = { domains: new Set(), names: new Set() };
  for (const row of data ?? []) {
    if (row.domain) blocked.domains.add(domainOf(row.domain as string));
    const name = normalizeCompanyName(String(row.name ?? ""));
    if (name) blocked.names.add(name);
  }
  return blocked;
}

/**
 * Positive replies by sector, from listed companies' cards, counted from their email touches: every card
 * with a sent email is a send whatever its status now (a dismissed card stays in the denominator), and a
 * positive or referral reply, a meeting, or a qualified or opportunity stage counts as positive.
 */
export async function learnedSectorWeights(db: Db): Promise<Record<string, number>> {
  const { data: listed } = await db.from("list_candidates").select("domain,sector_key").eq("status", "listed").not("sector_key", "is", null).limit(5000);
  const sectorByDomain = new Map((listed ?? []).map((row) => [domainOf(row.domain as string), String(row.sector_key)]));
  if (!sectorByDomain.size) return {};
  type CardRow = { id: string; status: string | null; meeting_at?: string | null; qualified_at?: string | null; opportunity_at?: string | null; accounts: { domain: string } | null };
  const cards: CardRow[] = [];
  const domains = [...sectorByDomain.keys()];
  for (let index = 0; index < domains.length; index += 200) {
    const { data } = await db.from("cards").select("id,status,meeting_at,qualified_at,opportunity_at,accounts!inner(domain)").in("accounts.domain", domains.slice(index, index + 200));
    cards.push(...((data ?? []) as unknown as CardRow[]));
  }
  if (!cards.length) return {};
  const byId = new Map(cards.map((card) => [card.id, card]));
  const rows: OutcomeTouch[] = [];
  const ids = [...byId.keys()];
  for (let index = 0; index < ids.length; index += 200) {
    const { data } = await db.from("touches").select("card_id,channel,sent_at,reply_classification").in("card_id", ids.slice(index, index + 200));
    for (const touch of (data ?? []) as Array<{ card_id: string; channel: string; sent_at: string | null; reply_classification: string | null }>) {
      const card = byId.get(touch.card_id);
      if (!card) continue;
      rows.push({
        cardId: card.id, sector: sectorByDomain.get(domainOf(card.accounts?.domain ?? "")) ?? null, channel: touch.channel, sentAt: touch.sent_at, replyClassification: touch.reply_classification,
        cardStatus: card.status, meetingAt: card.meeting_at ?? null, qualifiedAt: card.qualified_at ?? null, opportunityAt: card.opportunity_at ?? null,
      });
    }
  }
  return sectorWeights(listOutcomes(rows).bySector);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const index = next++; out[index] = await fn(items[index]); } };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

export type SourcingYield = { parsed: number; kept: number };

/**
 * Find new companies in published rankings, two sectors a night in rotation (moving on a pair after each
 * empty or failed call). Free checks before anything is saved: the ranking URL, exclusions by domain and by
 * client or do-not-contact name, the sector, the homepage and the mail server.
 */
async function sourceCandidates(db: Db, listDate: string, context: { recordCost: (cost: number) => void; signal: AbortSignal; offset: number }): Promise<SourcingYield> {
  const config = nightlyListConfig();
  const day = Math.floor(Date.parse(`${listDate}T00:00:00Z`) / 86_400_000);
  const weights = await learnedSectorWeights(db).catch(() => ({} as Record<string, number>));
  const chosen = sectorsForNight(day + context.offset, weights);
  const known = await knownCompanies(db);
  const { data: prior } = await db.from("list_candidates").select("domain,source_url").in("sector_key", chosen).order("created_at", { ascending: false }).limit(2000);
  const prompt = sourcingPrompt(chosen, (prior ?? []).map((row) => domainOf(row.domain as string)), minedHosts((prior ?? []).map((row) => row.source_url as string | null)));
  const budget = researchBudget(config.sourcingSearches, config.maxCostPerCompanyUsd * 2);
  const raw = sourced.parse(await runSearchAgent(prompt, { model: researchModel(), maxSearches: config.sourcingSearches, maxTokens: 8_000, signal: context.signal }, withBudget(context.recordCost, budget)));
  const usable = (domain: string) => validDomain(domain) && !known.domains.has(domain);
  const seen = new Set<string>();
  const companies = raw.companies
    .map((item) => sourcedCompany.safeParse(item))
    .flatMap((result) => (result.success && result.data.sourceUrl ? [{ ...result.data, sourceUrl: result.data.sourceUrl, domain: domainOf(result.data.domain) }] : []))
    .filter((company) => usable(company.domain) && !known.names.has(normalizeCompanyName(company.company)))
    .filter((company) => !isExcludedSector(company.sector))
    .filter((company) => company.revenueUsdM === null || (company.revenueUsdM >= 10 && company.revenueUsdM <= 100))
    .filter((company) => !seen.has(company.domain) && Boolean(seen.add(company.domain)));
  const checked = await mapLimit(companies, config.concurrency, async (company) => {
    if (context.signal.aborted) return null;
    const site = await verifySite(company.domain, company.company, fetch, { signal: context.signal, mailHost: domainAcceptsMail }).catch(() => ({ action: "unconfirmed" as const, domain: company.domain, reason: "check failed" }));
    if (site.action === "drop") return null;
    if (site.domain !== company.domain && !usable(site.domain)) return null;
    return { ...company, domain: site.domain, confirmed: site.action === "keep" };
  });
  const final = new Set<string>();
  const rows = checked
    .filter((company): company is NonNullable<typeof company> => company !== null && !final.has(company.domain) && Boolean(final.add(company.domain)))
    .map((company) => {
      const sectorKey = sectorKeyFor(company.sectorNumber);
      const score = priorScore({ revenueUsdM: company.revenueUsdM, locations: company.locations, fieldService: company.fieldService, sectorRank: sectorKey ?? NEUTRAL_SECTOR_RANK, sectorWeight: sectorKey === null ? 1 : weights[String(sectorKey)] ?? 1 });
      return {
        company: company.company.trim(), domain: company.domain, sector: company.sector.trim(), revenue_usd_m: company.revenueUsdM, revenue_year: company.revenueYear, source_url: company.sourceUrl,
        sector_key: sectorKey, prior_score: company.confirmed ? score : Math.max(0, score - UNCONFIRMED_PRIOR_PENALTY),
      };
    });
  console.info(`[night-watch] sourcing ${chosen.join("+")}: ${raw.companies.length} returned, ${rows.length} kept`);
  if (!rows.length) return { parsed: raw.companies.length, kept: 0 };
  const { data, error } = await db.from("list_candidates").upsert(rows, { onConflict: "domain", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`Could not save new companies: ${error.message}`);
  return { parsed: raw.companies.length, kept: data?.length ?? 0 };
}

const checkOf = (row: ListRow) => (row as ListRow & { emailCheck?: RecipientCheck }).emailCheck ?? null;

/** Auto-send is on, not paused and has a postal address for this seat, so deliverable rows will send unattended. */
async function autoSendLive(db: Db, owner: Owner): Promise<boolean> {
  const { data, error } = await db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle();
  if (error || !data) return false;
  return autoSendBlocker({ autoSend: Boolean(data.auto_send), paused: Boolean(data.auto_send_paused), postalAddress: String(data.postal_address ?? "").trim() }) === null;
}

type PrepareOutcome = { domain: string; reason: string; stage: "prepare"; status?: number };
const prepareOutcomes = (errors: unknown[]) => errors.filter((item): item is PrepareOutcome => Boolean(item) && typeof item === "object" && (item as { stage?: unknown }).stage === "prepare");
/** A refused preparation (an exclusion, a 4xx) is final; a thrown one is retried at most three times. */
const preparedFinally = (errors: unknown[], domain: string) => {
  const mine = prepareOutcomes(errors).filter((item) => item.domain === domain);
  return mine.some((item) => typeof item.status === "number") || mine.length >= 3;
};

/**
 * Prepare a card for each row (the same path as opening the desk) and save each address check on the
 * person. Refusals land in the list's errors; prepared_at is set once every row has a card or a final
 * outcome, so a later run only retries what threw.
 */
async function prepareRows(db: Db, list: Pick<ListRecord, "id" | "owner" | "errors">, rows: ListRow[]) {
  await loadNightlyLists(db, { force: true });
  const builder = { id: "nightly-list", email: "", name: "Night Watch", owner: list.owner, role: "admin" as const };
  const outcomes: PrepareOutcome[] = [];
  let settled = true;
  for (const row of rows) {
    try {
      const response = await preparePriorityDraft(row.domain, builder, db);
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        outcomes.push({ domain: row.domain, reason: typeof body?.error === "string" ? body.error : `preparation refused (${response.status})`, stage: "prepare", status: response.status });
        continue;
      }
      const check = checkOf(row);
      if (!check) continue;
      const { data: account } = await db.from("accounts").select("id").eq("domain", row.domain).maybeSingle();
      if (!account) continue;
      const { data: person } = await db.from("people").select("id,full_name,email,email_status,email_source,email_verified_at,email_check").eq("account_id", account.id).ilike("full_name", row.buyer.name).maybeSingle();
      if (person && person.email?.toLowerCase() === check.email) await recordRecipientCheck(db, person as RecipientPerson, check);
    } catch (error) {
      console.error(`[night-watch] could not prepare ${row.domain} for ${list.owner}: ${message(error)}`);
      outcomes.push({ domain: row.domain, reason: `could not prepare: ${message(error)}`.slice(0, 300), stage: "prepare" });
      if (!preparedFinally([...list.errors, ...outcomes], row.domain)) settled = false;
    }
  }
  if (outcomes.length) {
    const { data } = await db.from("reachout_lists").select("errors").eq("id", list.id).maybeSingle();
    await db.from("reachout_lists").update({ errors: [...((data?.errors ?? []) as unknown[]), ...outcomes].slice(-50) }).eq("id", list.id);
  }
  // Before migration 0029 the column is missing and this write is refused; preparePendingRows then re-checks by cards.
  if (settled) await db.from("reachout_lists").update({ prepared_at: new Date().toISOString() }).eq("id", list.id);
}

/**
 * Close a list: keep its `size` best (by AI fit, with a small lift for rows that can auto-send while the
 * seat's auto-send is live), and return the runners-up to the pool as reserves a later night can use
 * without researching them again. The status change is a claim, so of two runs closing the same list only
 * one demotes reserves and prepares cards. Throws when the write fails.
 */
async function finalizeList(db: Db, list: ListRecord): Promise<{ closed: boolean }> {
  const config = nightlyListConfig();
  const ranked = rankForList(list.rows, await autoSendLive(db, list.owner));
  const kept = ranked.slice(0, config.size).map((row, index) => ({ ...row, rank: index + 1 }) as ListRow);
  const keptDomains = new Set(kept.map((row) => row.domain));
  const status = kept.length ? "ready" : "failed";
  const { data: claimed, error } = await db.from("reachout_lists").update({ status, rows: kept, offers: list.offers.filter((offer) => keptDomains.has(offer.domain)), updated_at: new Date().toISOString() }).eq("id", list.id).eq("status", "building").select("id");
  if (error) throw new Error(`Could not close ${list.owner}'s list: ${error.message}`);
  if (!claimed?.length) return { closed: false };
  for (const row of ranked.slice(config.size)) {
    const offer = list.offers.find((item) => item.domain === row.domain);
    await db.from("list_candidates").update({ status: "reserve", owner: null, list_date: null, prepared: { row, offer } satisfies Partial<Prepared>, updated_at: new Date().toISOString() }).eq("domain", row.domain);
  }
  if (status === "ready") await prepareRows(db, list, kept);
  return { closed: true };
}

/** Close every list for the date that is still building, with the rows it has. For the morning run and the deadline. */
export async function finalizeOpenLists(db: Db, listDate: string): Promise<Array<{ owner: Owner; closed: boolean }>> {
  const out: Array<{ owner: Owner; closed: boolean }> = [];
  for (const list of (await loadLists(db, listDate)).filter((item) => item.status === "building")) out.push({ owner: list.owner, ...(await finalizeList(db, list)) });
  return out;
}

/**
 * Prepare cards for ready lists whose preparation never finished (prepared_at null), skipping companies that
 * already have a card or a final recorded outcome. Safe to repeat: preparation never reopens a sent card.
 */
export async function preparePendingRows(db: Db, listDate: string): Promise<number> {
  const query = (columns: string) => db.from("reachout_lists").select(columns).eq("list_date", listDate).eq("status", "ready");
  let { data, error } = await query("id,owner,rows,errors").is("prepared_at", null);
  // Before migration 0029 there is no prepared_at: check every ready list against its cards.
  if (error) ({ data, error } = await query("id,owner,rows,errors"));
  if (error) throw new Error(`Could not read tonight's lists: ${error.message}`);
  let prepared = 0;
  for (const list of (data ?? []) as unknown as Array<{ id: string; owner: Owner; rows: ListRow[] | null; errors: unknown[] | null }>) {
    const rows = list.rows ?? [], errors = list.errors ?? [];
    if (!rows.length) continue;
    const { data: cards } = await db.from("cards").select("id,accounts!inner(domain)").in("accounts.domain", rows.map((row) => row.domain));
    const withCard = new Set(((cards ?? []) as unknown as Array<{ accounts: { domain: string } | null }>).map((card) => card.accounts?.domain ?? ""));
    const pending = rows.filter((row) => !withCard.has(row.domain) && !preparedFinally(errors, row.domain));
    if (!pending.length) { await db.from("reachout_lists").update({ prepared_at: new Date().toISOString() }).eq("id", list.id); continue; }
    await prepareRows(db, { id: list.id, owner: list.owner, errors }, pending);
    prepared += pending.length;
  }
  return prepared;
}

/**
 * Take a reserve onto this list: an earlier night's finished row, moved to this seat and date. Free. For a
 * seat whose auto-send is live, reserves with a deliverable address come first.
 */
async function claimReserve(db: Db, write: ListWrite, list: ListRecord, listDate: string, minFit: number, reserveDays: number, live: boolean, blocked: Blocked): Promise<boolean> {
  const since = new Date(Date.now() - reserveDays * 86_400_000).toISOString();
  const { data } = await db.from("list_candidates").select("id,domain,company,prepared,fit_score").eq("status", "reserve").gte("researched_at", since).gte("fit_score", minFit).order("fit_score", { ascending: false }).limit(10);
  const reserves = (data ?? []) as Array<{ id: string; domain: string; company?: string | null; prepared: Prepared | null; fit_score: number | null }>;
  const order = live ? [...reserves].sort((a, b) => Number(autoSendable(b.prepared?.row)) - Number(autoSendable(a.prepared?.row)) || (b.fit_score ?? 0) - (a.fit_score ?? 0)) : reserves;
  for (const reserve of order) {
    const prepared = reserve.prepared;
    if (!prepared?.row || !prepared.offer) continue;
    // A reserve can wait up to reserveDays: drop it if the account became a client or do-not-contact since.
    if (blocked.domains.has(domainOf(reserve.domain)) || blocked.names.has(normalizeCompanyName(String(reserve.company ?? prepared.row.company ?? "")))) {
      await db.from("list_candidates").update({ status: "skipped", skip_reason: "excluded: client or do-not-contact account", updated_at: new Date().toISOString() }).eq("id", reserve.id).eq("status", "reserve");
      continue;
    }
    const { data: claimed } = await db.from("list_candidates").update({ status: "listed", owner: list.owner, list_date: listDate, updated_at: new Date().toISOString() }).eq("id", reserve.id).eq("status", "reserve").select("id");
    if (!claimed?.length) continue;
    const row = { ...prepared.row, assignedOwner: ownerKey(list.owner), contacts: prepared.row.contacts.map((contact) => ({ ...contact, contact_id: `nightly-${listDate}-${reserve.domain}` })) } as ListRow;
    await write(list.id, (fresh) => ({ rows: [...fresh.rows, row], offers: [...fresh.offers, prepared.offer], attempts: fresh.attempts + 1 }));
    return true;
  }
  return false;
}

/**
 * Claims left by an invocation that was killed mid-research. Their cost was never recorded, so tonight's
 * list is charged the per-company cap. A company cut off twice is skipped; the rest go back in the queue.
 */
async function reclaimStale(db: Db, write: ListWrite, lists: ListRecord[], listDate: string, now: Date, withAttempts: boolean, maxCostPerCompanyUsd: number) {
  const before = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  const { data } = await db.from("list_candidates").select(withAttempts ? "id,domain,owner,list_date,research_attempts" : "id,domain,owner,list_date").eq("status", "researching").lt("updated_at", before).limit(200);
  for (const row of (data ?? []) as unknown as Array<{ id: string; domain: string; owner: Owner | null; list_date: string | null; research_attempts?: number | null }>) {
    const next = reclaimStatus(withAttempts ? Number(row.research_attempts ?? 0) : 0);
    const patch = next.status === "new"
      ? { status: "new", owner: null, list_date: null, updated_at: now.toISOString() }
      : { status: "skipped", skip_reason: next.skipReason, researched_at: now.toISOString(), updated_at: now.toISOString() };
    const { data: moved } = await db.from("list_candidates").update(patch).eq("id", row.id).eq("status", "researching").select("id");
    if (!moved?.length || row.list_date !== listDate) continue;
    const list = lists.find((item) => item.owner === row.owner);
    if (!list) continue;
    await write(list.id, (fresh) => ({
      cost_usd: money(fresh.cost_usd + maxCostPerCompanyUsd),
      ...(next.status === "skipped" ? { attempts: fresh.attempts + 1, errors: [...fresh.errors, { domain: row.domain, reason: next.skipReason }].slice(-50) } : {}),
    }));
  }
}

/** One more try for companies lost to a transient failure or a near-miss fit, 30 days on (see shouldRequeue). */
async function requeueSkipped(db: Db, minFit: number, now: Date) {
  const before = new Date(now.getTime() - REQUEUE_AFTER_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.from("list_candidates").select("id,skip_reason,researched_at,retry_count,prior_score").eq("status", "skipped").eq("retry_count", 0).lt("researched_at", before).limit(500);
  if (error) return 0;
  let requeued = 0;
  for (const row of (data ?? []) as Array<{ id: string; skip_reason: string | null; researched_at: string | null; retry_count: number | null; prior_score: number | null }>) {
    if (!shouldRequeue({ skipReason: row.skip_reason, researchedAt: row.researched_at, retryCount: row.retry_count, minFit, now })) continue;
    const { data: moved } = await db.from("list_candidates").update({
      status: "new", retry_count: 1, research_attempts: 0, skip_reason: null, owner: null, list_date: null, prior_score: Math.max(0, Number(row.prior_score ?? 0) - REQUEUE_PRIOR_PENALTY), updated_at: now.toISOString(),
    }).eq("id", row.id).eq("status", "skipped").eq("retry_count", 0).select("id");
    requeued += moved?.length ?? 0;
  }
  return requeued;
}

/**
 * Claim tonight's once-a-night failure alert. True for the one caller that stamps alerted_at (0029) on the
 * first seat's list while it is still empty; false on a non-send day, when the stamp is already set, or
 * before the migration.
 */
export async function claimBuildAlert(db: Db, now: Date = new Date()): Promise<boolean> {
  const local = localParts(now);
  if (!isSendDay(local.weekday, local.date)) return false;
  const { error: upsertError } = await db.from("reachout_lists").upsert(LIST_OWNERS.map((owner) => ({ list_date: local.date, owner })), { onConflict: "list_date,owner", ignoreDuplicates: true });
  if (upsertError) return false;
  const { data, error } = await db.from("reachout_lists").update({ alerted_at: now.toISOString() }).eq("list_date", local.date).eq("owner", LIST_OWNERS[0]).is("alerted_at", null).select("id");
  return !error && Array.isArray(data) && data.length > 0;
}

export type NightlyListResult = {
  listDate: string;
  lists: Array<{ owner: Owner; status: string; rows: number; deliverable: number; attempts: number; costUsd: number }>;
  sourced: number;
  sourcing: SourcingYield[];
  reservesUsed: number;
  stopped: "done" | "time_budget" | "cost_budget" | "no_candidates" | "sourcing_retry" | "deadline" | "not_a_send_day";
};

export type NightlyBuildOptions = {
  now?: Date;
  /** Milliseconds since some fixed point, for the start cutoff. */
  clock?: () => number;
  /** No research batch or sourcing call starts after this much of the invocation (default 180 s). */
  timeBudgetMs?: number;
  /** In-flight model calls are aborted here (default 270 s). */
  abortAtMs?: number;
  /** How long an aborted task may take to return before it is treated as aborted with no recorded cost. */
  abortGraceMs?: number;
};

/**
 * Build tonight's lists. Resumable: each cron invocation does what fits in its time budget and saves
 * progress in reachout_lists and list_candidates; the next invocation carries on.
 *
 * Each list evaluates `research` companies: reserves from earlier nights first (free), then new companies in
 * order of their pre-research score. Companies under the AI-fit minimum are skipped. When a list has
 * evaluated enough, or the night's budget or the pool runs out, or the finalize deadline passes, it keeps its
 * `size` best by AI fit. Nothing is built for a day that is not a send day.
 */
export async function runNightlyListBuild(db: Db, options: NightlyBuildOptions = {}): Promise<NightlyListResult> {
  const config = nightlyListConfig();
  const clock = options.clock ?? Date.now;
  const started = clock();
  const startedAt = options.now ?? new Date();
  const wallNow = () => new Date(startedAt.getTime() + (clock() - started));
  const local = localParts(startedAt);
  const listDate = local.date;
  if (!isSendDay(local.weekday, listDate)) return { listDate, lists: [], sourced: 0, sourcing: [], reservesUsed: 0, stopped: "not_a_send_day" };

  // AI-fit selection stores scores and reserves in columns added by 0028; without them it would half-work.
  const { error: schemaError } = await db.from("list_candidates").select("prior_score,fit_score,prepared").limit(1);
  if (schemaError) throw new Error("Apply supabase/migrations/0027_nightly_lists.sql and 0028_ai_fit.sql in the Supabase SQL editor before the nightly list can run.");
  const { error: resilienceError } = await db.from("list_candidates").select("research_attempts,retry_count").limit(1);
  const has0029 = !resilienceError;
  await db.from("reachout_lists").upsert(LIST_OWNERS.map((owner) => ({ list_date: listDate, owner })), { onConflict: "list_date,owner", ignoreDuplicates: true });
  const write = listWriter(db);
  await reclaimStale(db, write, await loadLists(db, listDate), listDate, startedAt, has0029, config.maxCostPerCompanyUsd);
  if (has0029) await requeueSkipped(db, config.minFit, startedAt);
  await loadNightlyLists(db);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, (options.abortAtMs ?? ABORT_AT_MS) - (clock() - started)));
  const signal = controller.signal;
  const cutoff = options.timeBudgetMs ?? START_CUTOFF_MS;
  const grace = options.abortGraceMs ?? 5_000;
  const live = new Map<Owner, boolean>();
  const isLive = async (owner: Owner) => { if (!live.has(owner)) live.set(owner, await autoSendLive(db, owner)); return live.get(owner)!; };
  const sourcing: SourcingYield[] = [];
  let reservesUsed = 0, sourcedThisRun = false, reservesExhausted = false, lastAdded = 0, lastFailed = false;
  let blocked: Blocked | null = null;
  let stopped: NightlyListResult["stopped"] = "done";

  /** Resolves when the research does, or as aborted once the deadline and its grace have passed. */
  const abortable = (task: Promise<ResearchResult>) => Promise.race([task, new Promise<ResearchResult>((resolve) => {
    const fire = () => setTimeout(() => resolve({ aborted: true, cost: 0, searches: 0 }), grace);
    if (signal.aborted) fire(); else signal.addEventListener("abort", fire, { once: true });
  })]);

  const persist = async (list: ListRecord, candidate: Queued, attempts: number, result: ResearchResult) => {
    const now = new Date().toISOString();
    const cost = money(result.cost);
    const candidateCost = money(Number(candidate.cost_usd ?? 0) + result.cost);
    if (result.aborted) {
      // Cut off by the deadline: back in the queue without using one of the list's evaluations, unless it was the second time.
      const next = reclaimStatus(has0029 ? attempts : 0);
      await write(list.id, (fresh) => ({
        cost_usd: money(fresh.cost_usd + cost),
        ...(next.status === "skipped" ? { attempts: fresh.attempts + 1, errors: [...fresh.errors, { domain: candidate.domain, reason: next.skipReason }].slice(-50) } : {}),
      }));
      await db.from("list_candidates").update(next.status === "new"
        ? { status: "new", owner: null, list_date: null, cost_usd: candidateCost, updated_at: now }
        : { status: "skipped", skip_reason: next.skipReason, cost_usd: candidateCost, researched_at: now, updated_at: now }).eq("id", candidate.id).eq("status", "researching");
      return;
    }
    const skip = result.skip ? failureReason(result.skip) : null;
    let asReserve = false;
    await write(list.id, (fresh) => {
      // Another run closed this list while the research ran: keep the spend, and keep a good row for a later night.
      if (fresh.status !== "building") { asReserve = Boolean(result.row && result.offer); return { cost_usd: money(fresh.cost_usd + cost) }; }
      return {
        rows: result.row ? [...fresh.rows, result.row] : fresh.rows,
        offers: result.offer ? [...fresh.offers, result.offer] : fresh.offers,
        errors: skip ? [...fresh.errors, { domain: candidate.domain, reason: skip }].slice(-50) : fresh.errors,
        attempts: fresh.attempts + 1, cost_usd: money(fresh.cost_usd + cost),
      };
    });
    await db.from("list_candidates").update({
      status: asReserve ? "reserve" : result.row ? "listed" : "skipped", skip_reason: skip, cost_usd: candidateCost,
      ...(asReserve ? { owner: null, list_date: null, prepared: { row: result.row, offer: result.offer } } : {}),
      fit_score: result.fit?.score ?? null, fit: result.fit ?? null, researched_at: now, updated_at: now,
    }).eq("id", candidate.id);
  };

  try {
    for (;;) {
      const lists = await loadLists(db, listDate);
      const building = lists.filter((list) => list.status === "building");
      if (!building.length) break;
      if (pastFinalizeDeadline(wallNow())) { stopped = "deadline"; for (const list of building) await finalizeList(db, list); break; }
      const { count: researching } = await db.from("list_candidates").select("id", { count: "exact", head: true }).eq("status", "researching").eq("list_date", listDate);
      const spent = committedSpend(lists.reduce((sum, list) => sum + list.cost_usd, 0), researching ?? 0, config.maxCostPerCompanyUsd);
      const budgetSlots = slotsWithinBudget(config.budgetUsd, spent, config.maxCostPerCompanyUsd);
      if (budgetSlots <= 0) {
        stopped = "cost_budget";
        // Companies still being researched elsewhere may yet add rows; a later run closes the lists.
        if (!researching) for (const list of building) await finalizeList(db, list);
        break;
      }
      for (const list of building) if (list.attempts >= config.research) await finalizeList(db, list);
      const open = building.filter((list) => list.attempts < config.research);
      if (!open.length) continue;
      if (signal.aborted || !canStartBatch(clock() - started, cutoff)) { stopped = "time_budget"; break; }

      blocked ??= await blockedAccounts(db);
      if (!reservesExhausted) {
        let claimedAny = false;
        for (const list of open) if (await claimReserve(db, write, list, listDate, config.minFit, config.reserveDays, await isLive(list.owner), blocked)) { claimedAny = true; reservesUsed += 1; }
        if (claimedAny) continue;
        reservesExhausted = true;
      }

      const slots = Math.min(config.concurrency, budgetSlots, open.reduce((sum, list) => sum + (config.research - list.attempts), 0));
      const columns = `id,company,domain,sector,revenue_usd_m,revenue_year,source_url,sector_key,cost_usd${has0029 ? ",research_attempts" : ""}`;
      const { data: queued } = await db.from("list_candidates").select(columns).eq("status", "new").order("prior_score", { ascending: false }).order("revenue_usd_m", { ascending: false, nullsFirst: false }).limit(slots * 2);
      const queue = (queued ?? []) as unknown as Queued[];

      // Rows can sit in the queue for days: drop any that became a client or do-not-contact account since sourcing.
      blocked ??= await blockedAccounts(db);
      const excluded = queue.filter((candidate) => blocked!.domains.has(domainOf(candidate.domain)) || blocked!.names.has(normalizeCompanyName(candidate.company)));
      if (excluded.length) {
        for (const candidate of excluded) await db.from("list_candidates").update({ status: "skipped", skip_reason: "excluded: client or do-not-contact account", updated_at: new Date().toISOString() }).eq("id", candidate.id).eq("status", "new");
        continue;
      }

      const attemptsSoFar = sourcingAttempts(lists.flatMap((list) => list.errors));
      const action = nextSourcingAction({ queueLength: queue.length, slots, sourcedThisRun, sourcingAdded: lastAdded, sourcingFailed: lastFailed, sourcingAttempts: attemptsSoFar, pastDeadline: false });
      if (action === "source") {
        const cap = config.maxCostPerCompanyUsd * 2;
        if (config.budgetUsd - spent >= cap) {
          sourcedThisRun = true;
          const firstList = lists[0];
          // Charge the cap before the call, so a killed invocation still counts it; replaced by the real cost after.
          await write(firstList.id, (fresh) => ({ cost_usd: money(fresh.cost_usd + cap) }));
          let actual = 0, failure: string | null = null, result: SourcingYield = { parsed: 0, kept: 0 };
          try {
            result = await sourceCandidates(db, listDate, { recordCost: (cost) => { actual += cost; }, signal, offset: attemptsSoFar });
          } catch (error) {
            failure = message(error).slice(0, 300);
            console.error(`[night-watch] sourcing failed: ${failure}`);
          }
          sourcing.push(result);
          lastAdded = result.kept;
          lastFailed = failure !== null;
          // A call cut off by this invocation's deadline says nothing about the rankings, so it is not an attempt.
          const empty = signal.aborted ? null : failure ?? (result.kept ? null : `no new companies (${result.parsed} returned)`);
          await write(firstList.id, (fresh) => ({
            cost_usd: money(Math.max(0, fresh.cost_usd - cap + actual)),
            ...(empty ? { errors: [...fresh.errors, { kind: "sourcing", reason: `sourcing: ${empty}` }].slice(-50) } : {}),
          }));
          continue;
        }
        if (!queue.length) { stopped = "cost_budget"; for (const list of open) await finalizeList(db, list); break; }
      } else if (action === "stop-and-retry") {
        stopped = "sourcing_retry";
        break;
      } else if (action === "finalize") {
        stopped = "no_candidates";
        for (const list of open) await finalizeList(db, list);
        break;
      }

      // Never give a list more research in flight than it has evaluations left, alternating seats.
      const room = new Map(open.map((list) => [list.id, config.research - list.attempts]));
      const tasks: Array<{ list: ListRecord; candidate: Queued; attempts: number }> = [];
      let turn = 0;
      for (const candidate of queue) {
        const withRoom = open.filter((list) => (room.get(list.id) ?? 0) > 0);
        if (tasks.length >= slots || !withRoom.length) break;
        const list = withRoom[turn++ % withRoom.length];
        const attempts = Number(candidate.research_attempts ?? 0) + 1;
        const { data: claimed } = await db.from("list_candidates").update({ status: "researching", owner: list.owner, list_date: listDate, updated_at: new Date().toISOString(), ...(has0029 ? { research_attempts: attempts } : {}) }).eq("id", candidate.id).eq("status", "new").select("id");
        if (claimed?.length) { tasks.push({ list, candidate, attempts }); room.set(list.id, (room.get(list.id) ?? 0) - 1); }
      }
      // Each task saves the moment it finishes, so a task that hangs past the deadline cannot lose the others' work.
      await Promise.all(tasks.map(async ({ list, candidate, attempts }) => {
        const result = await abortable(researchOne(candidate, list.owner, listDate, { signal, now: wallNow() }));
        await persist(list, candidate, attempts, result);
      }));
    }
  } finally {
    clearTimeout(timer);
  }

  const lists = await loadLists(db, listDate);
  return {
    listDate, sourced: sourcing.reduce((sum, item) => sum + item.kept, 0), sourcing, reservesUsed, stopped,
    lists: lists.map((list) => ({ owner: list.owner, status: list.status, rows: list.rows.length, deliverable: list.rows.filter(autoSendable).length, attempts: list.attempts, costUsd: Number(list.cost_usd.toFixed(4)) })),
  };
}


// ---------- lists researched outside the app ----------

/** A company researched by hand or in another tool, with research in the shape researchPrompt asks for. */
export type ResearchedCompany = {
  company: string; domain: string; sector?: string; revenueUsdM?: number | null; revenueYear?: number | null; sourceUrl?: string | null; research: unknown;
};
export type ResearchedImport = {
  listDate: string; owner: Owner; status: string;
  listed: Array<{ domain: string; company: string; fit: number }>; reserved: string[]; skipped: Array<{ domain: string; reason: string }>;
};

/** Which of these domains a list could still use, and why each other one is out. Read-only. */
export async function screenDomains(db: Db, domains: string[]): Promise<Array<{ domain: string; usable: boolean; reason: string | null }>> {
  const known = await knownCompanies(db);
  return domains.map((raw) => {
    const domain = domainOf(raw);
    if (!validDomain(domain)) return { domain: raw, usable: false, reason: "not a valid domain" };
    if (known.domains.has(domain)) return { domain, usable: false, reason: "already known: on a list, researched before, contacted, a client or do-not-contact" };
    return { domain, usable: true, reason: null };
  });
}

/** An off-domain buyer page counts as seen only when it can be fetched and names the buyer. */
async function buyerPageSeen(research: unknown, domain: string, fetcher: Fetcher | undefined): Promise<SeenSource[]> {
  const buyer = (research as { buyer?: { name?: unknown; sourceUrl?: unknown } } | null)?.buyer;
  const url = typeof buyer?.sourceUrl === "string" ? buyer.sourceUrl : "";
  const surname = typeof buyer?.name === "string" ? buyer.name.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "" : "";
  if (!url || !surname || onDomain(url, domain)) return [];
  const page = await safeFetch(url, fetcher).catch(() => null);
  return page?.kind === "page" && page.html.toLowerCase().includes(surname) ? [{ url, title: null, page_age: null }] : [];
}

/**
 * Add companies researched outside the app to a seat's list for a date, through the same checks as the
 * nightly build: exclusions and companies already known, revenue and buyer rules, evidence confirmed by
 * fetching its page (nothing is taken on trust), the AI-fit minimum, template copy and the Hunter address
 * check. No model is called; copy that fails its checks is skipped rather than rewritten. The list keeps its
 * best `size` by AI fit, merged with any rows it already has; the rest become reserves. Cards are prepared
 * at once, and the morning run announces the list as usual.
 */
export async function importResearchedList(db: Db, input: { listDate: string; owner: Owner; companies: ResearchedCompany[] }, overrides: Partial<ResearchDeps> = {}): Promise<ResearchedImport> {
  const config = nightlyListConfig();
  const { listDate, owner } = input;
  const known = await knownCompanies(db);
  const existing = (await loadLists(db, listDate)).find((list) => list.owner === owner) ?? null;
  const skipped: ResearchedImport["skipped"] = [];
  const fresh: Array<{ row: ListRow; offer: ListOffer | undefined; fit: number }> = [];
  const seenNow = new Set<string>();

  for (const item of input.companies) {
    const domain = domainOf(item.domain ?? "");
    const skip = (reason: string) => skipped.push({ domain: domain || String(item.domain), reason });
    if (!validDomain(domain)) { skip("not a valid domain"); continue; }
    if (seenNow.has(domain)) { skip("listed twice in this import"); continue; }
    seenNow.add(domain);
    if (known.domains.has(domain)) { skip("already known: on a list, researched before, contacted, a client or do-not-contact"); continue; }
    if (known.names.has(normalizeCompanyName(item.company))) { skip("matches a client or do-not-contact company by name"); continue; }
    if (isExcludedSector(item.sector)) { skip("excluded sector"); continue; }

    const { data: saved, error } = await db.from("list_candidates").insert({
      company: item.company.trim(), domain, sector: (item.sector ?? "").trim(), revenue_usd_m: item.revenueUsdM ?? null, revenue_year: item.revenueYear ?? null,
      source_url: item.sourceUrl ?? null, status: "researching", owner, list_date: listDate, prior_score: 0, updated_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !saved) { skip(`could not save the company: ${error?.message ?? "no row"}`); continue; }
    const candidate: Candidate = { id: saved.id as string, company: item.company.trim(), domain, sector: (item.sector ?? "").trim(), revenue_usd_m: item.revenueUsdM ?? null, revenue_year: item.revenueYear ?? null, source_url: item.sourceUrl ?? null, sector_key: null };

    const seen = await buyerPageSeen(item.research, domain, overrides.fetcher);
    const result = await researchOne(candidate, owner, listDate, {
      agent: async () => ({ json: item.research, seen }),
      repair: async () => { throw new Error("no rewrite for researched imports: adjust the workflow fields and import again"); },
      ...overrides,
    });
    const now = new Date().toISOString();
    if (result.row) {
      fresh.push({ row: result.row, offer: result.offer, fit: result.fit?.score ?? 0 });
      await db.from("list_candidates").update({ status: "listed", fit_score: result.fit?.score ?? null, fit: result.fit ?? null, researched_at: now, updated_at: now }).eq("id", candidate.id);
    } else {
      skip(result.skip ?? "not listed");
      await db.from("list_candidates").update({ status: "skipped", skip_reason: (result.skip ?? "not listed").slice(0, 300), fit_score: result.fit?.score ?? null, fit: result.fit ?? null, researched_at: now, updated_at: now }).eq("id", candidate.id);
    }
  }

  const freshDomains = new Set(fresh.map((item) => item.row.domain));
  const prior = (existing?.rows ?? []).filter((row) => !freshDomains.has(row.domain));
  const offers = [...(existing?.offers ?? []).filter((offer) => !freshDomains.has(offer.domain)), ...fresh.flatMap((item) => (item.offer ? [item.offer] : []))];
  const ranked = rankForList([...prior, ...fresh.map((item) => item.row)], await autoSendLive(db, owner));
  const kept = ranked.slice(0, config.size).map((row, index) => ({ ...row, rank: index + 1 }) as ListRow);
  const keptDomains = new Set(kept.map((row) => row.domain));
  for (const row of ranked.slice(config.size)) {
    await db.from("list_candidates").update({ status: "reserve", owner: null, list_date: null, prepared: { row, offer: offers.find((offer) => offer.domain === row.domain) } satisfies Partial<Prepared>, updated_at: new Date().toISOString() }).eq("domain", row.domain);
  }

  const status = kept.length ? "ready" : existing?.status ?? "failed";
  const change = { status, rows: kept, offers: offers.filter((offer) => keptDomains.has(offer.domain)), updated_at: new Date().toISOString() };
  let listId = existing?.id ?? null;
  if (listId) {
    const { error } = await db.from("reachout_lists").update(change).eq("id", listId);
    if (error) throw new Error(`Could not save ${owner}'s list: ${error.message}`);
  } else {
    const { data, error } = await db.from("reachout_lists").insert({ list_date: listDate, owner, ...change }).select("id").single();
    if (error || !data) throw new Error(`Could not save ${owner}'s list: ${error?.message ?? "no row"}`);
    listId = data.id as string;
  }
  if (kept.length) await prepareRows(db, { id: listId, owner, errors: existing?.errors ?? [] }, kept.filter((row) => freshDomains.has(row.domain)));
  return {
    listDate, owner, status,
    listed: kept.filter((row) => freshDomains.has(row.domain)).map((row) => ({ domain: row.domain, company: row.company, fit: fresh.find((item) => item.row.domain === row.domain)?.fit ?? 0 })),
    reserved: ranked.slice(config.size).map((row) => row.domain).filter((domain) => freshDomains.has(domain)),
    skipped,
  };
}
