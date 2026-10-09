/** Pure rules for the nightly list build, kept free of app imports so they can be tested directly. */
import { REVENUE_BAND_USD_M, SECTORS } from "./list-sectors.ts";

// ---------- time ----------

/** Start a research batch or a sourcing call only while this much of the invocation is left unused. */
export const START_CUTOFF_MS = 180_000;
/** Abort in-flight model calls here, before Vercel kills the invocation at 300 s. */
export const ABORT_AT_MS = 270_000;

export function canStartBatch(elapsedMs: number, cutoffMs = START_CUTOFF_MS) {
  return elapsedMs < cutoffMs;
}

/** NIGHTLY_LIST_FINALIZE_AT_UTC as minutes after UTC midnight; default 09:40, the last-but-one nightly cron tick. */
export function finalizeAtUtc(value = process.env.NIGHTLY_LIST_FINALIZE_AT_UTC) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "");
  return match ? Math.min(23 * 60 + 59, Number(match[1]) * 60 + Number(match[2])) : 9 * 60 + 40;
}

/** Keyed to the UTC cron window rather than local time, so it holds in both EST and EDT. */
export function pastFinalizeDeadline(now: Date, at = finalizeAtUtc()) {
  return now.getUTCHours() * 60 + now.getUTCMinutes() >= at;
}

// ---------- spend ----------

/**
 * Money already spent or promised tonight: recorded cost plus the per-company cap for every company still
 * being researched (its cost is not recorded until it finishes, or ever if the invocation is killed).
 */
export function committedSpend(recordedUsd: number, researching: number, maxCostPerCompanyUsd: number) {
  return recordedUsd + Math.max(0, researching) * maxCostPerCompanyUsd;
}

/** How many companies the rest of the budget can pay for at their worst-case cost. */
export function slotsWithinBudget(budgetUsd: number, spentUsd: number, maxCostPerCompanyUsd: number) {
  if (maxCostPerCompanyUsd <= 0) return 0;
  return Math.max(0, Math.floor((budgetUsd - spentUsd + 1e-9) / maxCostPerCompanyUsd));
}

/** A company whose research was cut off this many times is not tried again tonight or later. */
export const MAX_RESEARCH_ATTEMPTS = 2;

/** Where a claim that never finished goes: back in the queue, or out after two tries. */
export function reclaimStatus(researchAttempts: number): { status: "new" } | { status: "skipped"; skipReason: string } {
  return researchAttempts >= MAX_RESEARCH_ATTEMPTS ? { status: "skipped", skipReason: "timed out twice" } : { status: "new" };
}

// ---------- sourcing ----------

/** Empty or failed sourcing calls in one night before the lists close with what they have. */
export const MAX_SOURCING_ATTEMPTS = 3;

export type SourcingAction = "source" | "research" | "stop-and-retry" | "finalize";

/**
 * What to do when the lists still have room. One bad sourcing call never ends the night: the lists stay
 * open for the next invocation until MAX_SOURCING_ATTEMPTS empty or failed calls, or the deadline.
 * `sourcingAdded` and `sourcingFailed` describe this invocation's last call.
 */
export function nextSourcingAction(input: { queueLength: number; slots: number; sourcedThisRun: boolean; sourcingAdded: number; sourcingFailed: boolean; sourcingAttempts: number; pastDeadline: boolean }): SourcingAction {
  const lastWorked = input.sourcingAdded > 0 && !input.sourcingFailed;
  const canSource = !input.pastDeadline && input.sourcingAttempts < MAX_SOURCING_ATTEMPTS && (!input.sourcedThisRun || lastWorked);
  if (input.queueLength < input.slots && canSource) return "source";
  if (input.queueLength > 0) return "research";
  if (input.pastDeadline || input.sourcingAttempts >= MAX_SOURCING_ATTEMPTS) return "finalize";
  return "stop-and-retry";
}

/** Failed or empty sourcing calls recorded in tonight's list errors. */
export function sourcingAttempts(errors: unknown[]) {
  return errors.filter((item) => Boolean(item) && typeof item === "object" && (item as { kind?: unknown }).kind === "sourcing").length;
}

const host = (raw: string) => {
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};

/** Distinct ranking hosts from earlier candidates' source URLs. */
export function minedHosts(sourceUrls: Array<string | null | undefined>, max = 40) {
  return [...new Set(sourceUrls.map((url) => (url ? host(url) : null)).filter((value): value is string => Boolean(value)))].slice(0, max);
}

/**
 * The paid sourcing prompt. `priorDomains` are every candidate already found in tonight's sectors and
 * `mined` the ranking hosts already used, so the model looks further down a list or at a different one.
 */
export function sourcingPrompt(chosen: number[], priorDomains: string[], mined: string[]) {
  const skip = [...new Set(priorDomains)].join(", ");
  return `Find privately held U.S. operating companies with annual revenue between $${REVENUE_BAND_USD_M.min}M and $${REVENUE_BAND_USD_M.max}M that appear in a published, dated industry ranking or list, for example Landscape Management's LM150, ENR regional rankings, a Crain's or Business Journal list of largest private companies, a trade association top-100 list, or an Inc. regional list that states revenue.

Focus on these sectors, numbered: ${chosen.map((index) => `${index}. ${SECTORS[index]}`).join("; ")}.
Prefer companies with several locations or branches, field crews or a fleet, or high order and quoting volume: the coordination and paperwork an AI tool can take on.
Exclude consulting, IT services, software, staffing, marketing agencies, banks, insurance, investment firms, nonprofits, schools, hospitals and publicly traded companies.${skip ? `\nAlready found, do not repeat these domains: ${skip}.` : ""}${mined.length ? `\nRankings already used: ${mined.join(", ")}. Use a different ranking, or the positions after those already used.` : ""}

For each company give its official website domain, its sector and the sector's number from the list above, the reported revenue in USD millions, the year it was reported for, the URL of the ranking page that states it, and, only if the ranking or the company's site shows it, how many locations it has and whether it runs field crews or a fleet. Never invent a company, a revenue figure, a domain or a URL; list only what the page shows. Aim for 25 companies.

Return JSON only: {"companies":[{"company":"","domain":"example.com","sector":"","sectorNumber":0,"revenueUsdM":0,"revenueYear":2025,"sourceUrl":"https://...","locations":null,"fieldService":null}]}`;
}

/** A sector number the model gave, or null when it is not one of ours. */
export function sectorKeyFor(sectorNumber: number | null | undefined) {
  return typeof sectorNumber === "number" && Number.isInteger(sectorNumber) && sectorNumber >= 0 && sectorNumber < SECTORS.length ? sectorNumber : null;
}

/** The middle of the sector order, for a candidate whose sector is unknown. */
export const NEUTRAL_SECTOR_RANK = Math.floor(SECTORS.length / 2);
/** Prior points taken off a candidate whose homepage could not be confirmed, so confirmed ones go first. */
export const UNCONFIRMED_PRIOR_PENALTY = 10;

const LEGAL = new Set(["inc", "incorporated", "llc", "l", "c", "ltd", "limited", "co", "corp", "corporation", "company", "lp", "llp", "pllc", "plc", "pc"]);

/** Lowercase, punctuation stripped, trailing legal suffixes dropped: "Acme Landscaping, LLC" is "acme landscaping". */
export function normalizeCompanyName(name: string) {
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEGAL.has(words[words.length - 1])) words.pop();
  if (words[0] === "the" && words.length > 1) words.shift();
  return words.join(" ");
}

// ---------- requeue ----------

export const REQUEUE_AFTER_DAYS = 30;
export const REQUEUE_PRIOR_PENALTY = 15;
/** Stored instead of "research failed:" when a company's own search or dollar cap stopped it. */
export const LIMIT_FAILURE = "research failed (limit)";

/** A spend or search cap message from SpendLimitError, which researchOne reports as a plain failure. */
export function failureReason(skip: string) {
  return /^research failed:/.test(skip) && /research cap|paid web searches are used up/i.test(skip) ? skip.replace(/^research failed:/, `${LIMIT_FAILURE}:`) : skip;
}

/**
 * Give a company one more try, 30 days on, when it was lost to something that may since have changed: a
 * transient research failure, or an AI fit within 10 points of the minimum. Never after a rejection, a
 * revenue or sector exclusion, a disqualifier, a non-person buyer or a spend cap.
 */
export function shouldRequeue(input: { skipReason: string | null; researchedAt: string | null; retryCount: number | null; minFit: number; now: Date }) {
  if ((input.retryCount ?? 0) !== 0 || !input.skipReason || !input.researchedAt) return false;
  const at = Date.parse(input.researchedAt);
  if (!Number.isFinite(at) || input.now.getTime() - at < REQUEUE_AFTER_DAYS * 86_400_000) return false;
  const reason = input.skipReason.trim();
  if (reason.startsWith(LIMIT_FAILURE)) return false;
  if (reason.startsWith("research failed")) return true;
  const fit = /^AI fit (\d+) is below/.exec(reason);
  return Boolean(fit) && Number(fit![1]) >= input.minFit - 10;
}

// ---------- ranking ----------

/** Points a deliverable, unheld address adds to fit when auto-send is live, so a sendable row wins a near tie. */
export const DELIVERABLE_BONUS = 8;

const field = (row: unknown, key: string): unknown => (row && typeof row === "object" ? (row as Record<string, unknown>)[key] : undefined);
export const fitScoreOf = (row: unknown) => {
  const score = field(field(row, "aiFit"), "score");
  return typeof score === "number" && Number.isFinite(score) ? score : 0;
};

/** The morning run can send this row unattended: a deliverable address and no identity hold. */
export function autoSendable(row: unknown) {
  const hold = field(row, "identityHold");
  return field(field(row, "emailCheck"), "level") === "deliverable" && !(typeof hold === "string" ? hold.trim() : hold);
}

/** List order: AI fit, plus DELIVERABLE_BONUS for an auto-sendable row only while auto-send is live. */
export function rankForList<T>(rows: T[], autoSendLive: boolean): T[] {
  const value = (row: T) => fitScoreOf(row) + (autoSendLive && autoSendable(row) ? DELIVERABLE_BONUS : 0);
  return rows.map((row, index) => ({ row, index })).sort((a, b) => value(b.row) - value(a.row) || a.index - b.index).map((item) => item.row);
}
