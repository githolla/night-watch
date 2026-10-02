import { z } from "zod";
import { hasPath, hostOf, isJobBoardUrl, onDomain } from "./evidence-grounding.ts";

/**
 * How good a candidate a company is for an AI implementation with Nine-67, 0 to 100.
 *
 * The research model only gathers dated, sourced facts; this file decides what they are worth, so a score
 * can never be asserted without evidence and every point traces to a link. The criteria follow the
 * product's own thesis (docs/scoring.md): companies hiring people for work a system could do, with
 * repetitive operations at scale, in a period of change, led by people open to technology, and with
 * systems already in place to build on.
 */

/** https only, a real host with a dot, and no template placeholder such as `https://...`. Never rewritten. */
const https = z.string().url().refine((url) => url.startsWith("https://") && !url.includes("...") && Boolean(hostOf(url)?.includes(".")), "must be a real https link");

const DATE_SHAPE = /^\d{4}-\d{2}(-\d{2})?$/;
/** `YYYY-MM-DD` or `YYYY-MM` that is a real calendar date, else null (undated). */
function validDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = value.trim();
  if (!DATE_SHAPE.test(date)) return null;
  const full = date.length === 7 ? `${date}-01` : date;
  const time = Date.parse(`${full}T00:00:00Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== full ? null : date;
}
const dated = z.unknown().transform(validDate);

/** Set by groundEvidence. Absent means the item was never checked (older callers). */
export const GROUNDINGS = ["seen", "confirmed", "unverified", "dropped"] as const;
export type Grounding = (typeof GROUNDINGS)[number];
const grounding = z.enum(GROUNDINGS).optional().catch(undefined);

/** Keep the items that parse and drop the rest, so one bad item never throws away the whole research. */
function kept<T extends z.ZodType>(item: T) {
  return z.array(z.unknown()).default([]).transform((items) => items.flatMap((value) => {
    const result = item.safeParse(value);
    return result.success ? [result.data as z.output<T>] : [];
  })).catch([]);
}

/** The only reasons that zero a score; anything else the model worries about is a concern. */
export const DISQUALIFIER_KINDS = ["software_or_it", "inhouse_ai_team", "closing_or_acquired", "subsidiary_of_large_company", "franchise_unit"] as const;
export type DisqualifierKind = (typeof DISQUALIFIER_KINDS)[number];
const DISQUALIFIER_LABELS: Record<DisqualifierKind, string> = {
  software_or_it: "a software or IT business",
  inhouse_ai_team: "a large in-house AI or engineering team",
  closing_or_acquired: "closing down or acquired",
  subsidiary_of_large_company: "a subsidiary of a large company",
  franchise_unit: "a franchise unit",
};
const disqualifierItem = z.object({ kind: z.enum(DISQUALIFIER_KINDS), fact: z.string().trim().default(""), url: https });

/** Move free text and unrecognized or unsourced disqualifiers into `concerns`, which never change the score. */
function splitDisqualifiers(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const input = raw as Record<string, unknown>;
  const concerns = (Array.isArray(input.concerns) ? input.concerns : []).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  const disqualifiers: unknown[] = [];
  for (const item of Array.isArray(input.disqualifiers) ? input.disqualifiers : []) {
    const parsed = disqualifierItem.safeParse(item);
    if (parsed.success) { disqualifiers.push(parsed.data); continue; }
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const note = typeof item === "string" ? item : typeof record.fact === "string" && record.fact.trim() ? record.fact : typeof record.kind === "string" ? record.kind : "";
    if (note.trim()) concerns.push(note.trim().slice(0, 300));
  }
  return { ...input, disqualifiers, concerns: [...new Set(concerns)] };
}

const nullableCount = z.number().int().nonnegative().nullable().default(null).catch(null);

export const aiFitEvidence = z.preprocess(splitDisqualifiers, z.object({
  /** Open roles doing coordination, scheduling, dispatch, estimating, admin, data or automation work. */
  hiring: kept(z.object({ title: z.string().trim().min(3), url: https, postedDate: dated, grounding })),
  /** Locations or branches, and field workforce, fleet or volume, with the page that shows it. */
  scale: z.object({ locations: nullableCount, fieldWorkforce: nullableCount, highVolume: z.string().nullable().default(null).catch(null), url: https.nullable().default(null).catch(null), grounding }).nullable().default(null).catch(null),
  /** Acquisitions, new locations, a new CEO, COO or operations leader, or new investment. */
  change: kept(z.object({ kind: z.string().trim().min(3), fact: z.string().trim().min(10), date: dated, url: https, grounding })),
  /** Leaders speaking publicly about AI, automation, technology or efficiency; technology or ops-tech roles. */
  techOpenness: kept(z.object({ fact: z.string().trim().min(10), date: dated, url: https, grounding })),
  /** Named business systems: field service, ERP, CRM, estimating, routing software, or a customer portal. */
  systems: kept(z.object({ name: z.string().trim().min(2), url: https, grounding })),
  /** Sourced reasons this is not a fit, one of DISQUALIFIER_KINDS. */
  disqualifiers: kept(disqualifierItem),
  /** Worries that are not a recognized, sourced disqualifier (for example "limited public information"). Shown, never scored. */
  concerns: z.array(z.string()).optional().catch(undefined),
}));
export type AiFitEvidence = z.infer<typeof aiFitEvidence>;

export type AiFitReason = { criterion: AiFitCriterion; points: number; text: string; url: string | null };
export type AiFitCriterion = "hiring" | "scale" | "change" | "techOpenness" | "systems";
export type AiFit = {
  score: number; breakdown: Record<AiFitCriterion, number>; reasons: AiFitReason[]; disqualified: string | null; summary: string;
  /** Free-text worries from the research; never change the score. */
  concerns: string[];
  /** Evidence items whose page could not be confirmed; they earned nothing. */
  unverified: number;
};

export const AI_FIT_MAX: Record<AiFitCriterion, number> = { hiring: 25, scale: 20, change: 20, techOpenness: 20, systems: 15 };
/** Added inside the hiring cap when 3 or more distinct automatable roles are open at once (a job cluster). */
export const HIRING_CLUSTER_BONUS = 5;
/** Dates further ahead than this are made up, not timezone slop, and earn nothing. */
const FUTURE_SLACK_DAYS = 7;

const DAY = 86_400_000;
function ageDays(date: string | null, now: number) {
  const valid = validDate(date);
  if (!valid) return null;
  const time = Date.parse(`${valid.length === 7 ? `${valid}-01` : valid}T00:00:00Z`);
  return Math.floor((now - time) / DAY);
}
/** Undated evidence still counts, at a discount; anything older than its window, or dated in the future, does not count at all. */
function freshness(date: string | null, now: number, window: number) {
  const age = ageDays(date, now);
  if (age === null) return 0.5;
  if (age < -FUTURE_SLACK_DAYS || age > window) return 0;
  return age <= window / 2 ? 1 : 0.7;
}

/** A real date, not more than a week in the future, and at most `windowDays` old. */
export function isFreshDate(date: string | null | undefined, windowDays: number, now: Date | number = Date.now()): boolean {
  const age = ageDays(date ?? null, typeof now === "number" ? now : now.getTime());
  return age !== null && age >= -FUTURE_SLACK_DAYS && age <= windowDays;
}

/** The hires where Nine-67 would build the system instead (docs/scoring.md, target job families). */
// Stems, so no trailing word boundary: "dispatch" must match Dispatcher, "schedul" Scheduling.
const AUTOMATABLE_ROLE = /\b(dispatch|schedul|coordinat|estimat|quot(e|es|ing|ation)\b|admin|clerk|billing|invoic|payable|receivable|bookkeep|data|report|analyst|automat|process|system|crm|erp|office manager|order entry|purchas|procure|operations specialist)/i;
/** Engineering, data science, plant, field and sales seats that share those stems but are not work a system takes on. */
const NOT_AUTOMATABLE = /\b(scientist|machine learning|ml|deep learning|computer vision|nlp|software|developer|data engineer|(process|plc|controls?|automation|systems?|network|field) engineer|technician|installer|operator|database administrator|account executive|sales rep(resentative)?|business development|quota|customer service rep(resentative)?|call center|support specialist)\b/i;
/** Seats that would otherwise trip the exclusion but are coordination work. */
const ALWAYS_AUTOMATABLE = /\b(estimat|sales coordinator|sales operations analyst)/i;

export function isAutomatableRole(title: string): boolean {
  if (ALWAYS_AUTOMATABLE.test(title)) return true;
  return !NOT_AUTOMATABLE.test(title) && AUTOMATABLE_ROLE.test(title);
}

const squashText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const counted = (item: { grounding?: Grounding }) => item.grounding !== "dropped" && item.grounding !== "unverified";

/** One copy per key, the one with the highest freshness, in first-seen order. */
function dedupe<T>(items: T[], key: (item: T) => string, rank: (item: T) => number): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const id = key(item);
    const current = best.get(id);
    if (!current || rank(item) > rank(current)) best.set(id, item);
  }
  return [...best.values()];
}

/** The size a volume claim states: "12,000 jobs a year" is 12000, "1.5 million orders" 1500000; null without a number. */
function volumeOf(text: string): number | null {
  const match = text.replace(/,(?=\d{3}\b)/g, "").match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million|mm|b|billion)?\b/i);
  if (!match) return null;
  const unit = (match[2] ?? "").toLowerCase();
  const scale = unit === "k" || unit === "thousand" ? 1e3 : unit === "m" || unit === "mm" || unit === "million" ? 1e6 : unit === "b" || unit === "billion" ? 1e9 : 1;
  return Number(match[1]) * scale;
}

export function aiFitScore(raw: unknown, options: { now?: Date; domain?: string | null } = {}): AiFit {
  const evidence = aiFitEvidence.parse(raw);
  const now = (options.now ?? new Date()).getTime();
  const domain = options.domain ?? null;
  const reasons: AiFitReason[] = [];
  const unverified = [...evidence.hiring, ...evidence.change, ...evidence.techOpenness, ...evidence.systems, ...(evidence.scale ? [evidence.scale] : [])].filter((item) => item.grounding === "unverified").length;

  // Without the company's domain the host cannot be judged, so hiring links are taken as given.
  const hiringHostOk = (url: string) => !domain || onDomain(url, domain) || isJobBoardUrl(url);
  const roles = dedupe(
    evidence.hiring.filter((item) => counted(item) && hiringHostOk(item.url) && isAutomatableRole(item.title)),
    (item) => squashText(item.title),
    (item) => freshness(item.postedDate, now, 90),
  );
  let hiring = 0;
  const credited: typeof roles = [];
  for (const role of roles.slice(0, 4)) {
    const points = Math.round(12 * freshness(role.postedDate, now, 90));
    if (!points) continue;
    hiring += points;
    credited.push(role);
    reasons.push({ criterion: "hiring", points, text: `Hiring: ${role.title}`, url: role.url });
  }
  if (credited.length >= 3) {
    hiring += HIRING_CLUSTER_BONUS;
    reasons.push({ criterion: "hiring", points: HIRING_CLUSTER_BONUS, text: `Hiring cluster: ${credited.length} roles of this kind open`, url: credited[0].url });
  }
  hiring = Math.min(AI_FIT_MAX.hiring, hiring);

  let scale = 0;
  if (evidence.scale?.url && counted(evidence.scale)) {
    const { locations, fieldWorkforce, highVolume, url } = evidence.scale;
    if ((locations ?? 0) >= 3) { scale += 10; reasons.push({ criterion: "scale", points: 10, text: `${locations} locations`, url }); }
    else if ((locations ?? 0) === 2) { scale += 5; reasons.push({ criterion: "scale", points: 5, text: "2 locations", url }); }
    const volume = highVolume?.trim() ? volumeOf(highVolume) : null;
    if ((fieldWorkforce ?? 0) >= 50) { scale += 10; reasons.push({ criterion: "scale", points: 10, text: `${fieldWorkforce} field staff or vehicles`, url }); }
    else if (highVolume && volume !== null && volume > 0) {
      const points = volume >= 1000 ? 8 : volume >= 100 ? 5 : 3;
      scale += points;
      reasons.push({ criterion: "scale", points, text: highVolume.trim(), url });
    }
  }
  scale = Math.min(AI_FIT_MAX.scale, scale);

  let change = 0;
  // The same event reported by several outlets: one kind within a month of each other (or, undated, the same fact).
  const changes: typeof evidence.change = [];
  for (const item of [...evidence.change.filter(counted)].sort((a, b) => freshness(b.date, now, 365) - freshness(a.date, now, 365))) {
    const kind = squashText(item.kind);
    const age = ageDays(item.date, now);
    const duplicate = changes.some((other) => {
      if (squashText(other.kind) !== kind) return false;
      const otherAge = ageDays(other.date, now);
      return age !== null && otherAge !== null ? Math.abs(age - otherAge) <= 31 : age === null && otherAge === null && squashText(other.fact) === squashText(item.fact);
    });
    if (!duplicate) changes.push(item);
  }
  for (const item of changes.slice(0, 3)) {
    const points = Math.round(14 * freshness(item.date, now, 365));
    if (!points) continue;
    change += points;
    reasons.push({ criterion: "change", points, text: item.fact, url: item.url });
  }
  change = Math.min(AI_FIT_MAX.change, change);

  let techOpenness = 0;
  const openness = dedupe(evidence.techOpenness.filter(counted), (item) => squashText(item.fact), (item) => freshness(item.date, now, 540));
  for (const item of openness.slice(0, 3)) {
    const points = Math.round(12 * freshness(item.date, now, 540));
    if (!points) continue;
    techOpenness += points;
    reasons.push({ criterion: "techOpenness", points, text: item.fact, url: item.url });
  }
  techOpenness = Math.min(AI_FIT_MAX.techOpenness, techOpenness);

  // A system counts from the company's own site, a job posting that names it, or a specific page elsewhere
  // (a vendor's customer story); a vendor's bare homepage proves nothing about this company.
  const systemHostOk = (url: string) => onDomain(url, domain) || isJobBoardUrl(url) || hasPath(url);
  const systemList = dedupe(evidence.systems.filter((item) => counted(item) && systemHostOk(item.url)), (item) => item.name.trim().toLowerCase(), () => 0);
  let systems = 0;
  for (const system of systemList.slice(0, 3)) {
    const points = Math.min(8, AI_FIT_MAX.systems - systems);
    if (points <= 0) break;
    systems += points;
    reasons.push({ criterion: "systems", points, text: `Runs on ${system.name.trim()}`, url: system.url });
  }

  const reason = evidence.disqualifiers[0];
  const disqualified = reason ? reason.fact || DISQUALIFIER_LABELS[reason.kind] : null;
  const breakdown = { hiring, scale, change, techOpenness, systems };
  const score = disqualified ? 0 : hiring + scale + change + techOpenness + systems;
  const top = [...reasons].sort((a, b) => b.points - a.points).slice(0, 3).map((item) => item.text);
  const summary = disqualified ? `Not a fit: ${disqualified}` : `AI fit ${score}/100${top.length ? `: ${top.join("; ")}` : ""}`;
  return { score, breakdown, reasons: reasons.sort((a, b) => b.points - a.points), disqualified, summary, concerns: evidence.concerns ?? [], unverified };
}

/**
 * Before paying for research: how promising a ranked company looks from what the ranking alone shows.
 * Operations-heavy sectors first, revenue in the $20M to $80M sweet spot, and any size hints the ranking
 * gave. `sectorWeight` is learned from replies (see sectorWeights) and defaults to 1.
 */
export function priorScore(input: { revenueUsdM: number | null; locations: number | null; fieldService: boolean | null; sectorRank: number; sectorWeight?: number }) {
  const revenue = input.revenueUsdM;
  const revenuePoints = revenue === null ? 5 : revenue >= 20 && revenue <= 80 ? 15 : revenue >= 10 && revenue <= 100 ? 8 : 0;
  const sectorPoints = Math.max(0, 20 - input.sectorRank * 2);
  const sizePoints = (input.locations ?? 0) >= 3 ? 10 : (input.locations ?? 0) === 2 ? 5 : 0;
  const fieldPoints = input.fieldService ? 5 : 0;
  return Math.round((revenuePoints + sectorPoints + sizePoints + fieldPoints) * (input.sectorWeight ?? 1));
}

// ---------- outcomes ----------

/** Reply labels that mean a person answered; "ooo" is an autoresponder, not a reply. */
export const REPLIED_CLASSIFICATIONS = ["positive", "neutral", "objection", "referral", "negative"] as const;
export const POSITIVE_CLASSIFICATIONS = ["positive", "referral"] as const;
const ADVANCED_STATUSES = new Set(["positive", "meeting", "qualified", "opportunity"]);
/** Optional partial credit for a plain human reply in sector learning; pass it to listOutcomes to turn it on. */
export const PLAIN_REPLY_WEIGHT = 0.3;

/** One touch on a card for a listed company, as read from touches joined to cards and list_candidates. */
export type OutcomeTouch = {
  cardId: string;
  sector: string | null;
  channel: string;
  sentAt: string | null;
  replyClassification: string | null;
  cardStatus?: string | null;
  meetingAt?: string | null;
  qualifiedAt?: string | null;
  opportunityAt?: string | null;
  fitScore?: number | null;
  breakdown?: Partial<Record<AiFitCriterion, number>> | null;
};
export type CardOutcome = { cardId: string; sector: string | null; positive: boolean; replied: boolean; fitScore: number | null; breakdown: Partial<Record<AiFitCriterion, number>> | null };
export type SectorTally = { sends: number; positive: number; replied: number };

/**
 * Outcomes per card, counted from touches rather than the card's current status: one send per card that has
 * a sent email touch (follow-ups add nothing), so a card later dismissed or archived stays in the
 * denominator. Positive means a positive or referral reply, or a meeting, qualified or opportunity stage.
 */
export function listOutcomes(rows: OutcomeTouch[], options: { plainReplyWeight?: number } = {}) {
  const cards = new Map<string, CardOutcome & { sent: boolean }>();
  for (const row of rows) {
    const card = cards.get(row.cardId) ?? { cardId: row.cardId, sector: null, positive: false, replied: false, fitScore: null, breakdown: null, sent: false };
    card.sector ??= row.sector;
    card.fitScore ??= row.fitScore ?? null;
    card.breakdown ??= row.breakdown ?? null;
    if (row.channel === "email" && row.sentAt) card.sent = true;
    const label = (row.replyClassification ?? "").toLowerCase();
    if ((REPLIED_CLASSIFICATIONS as readonly string[]).includes(label)) card.replied = true;
    if ((POSITIVE_CLASSIFICATIONS as readonly string[]).includes(label) || row.meetingAt || row.qualifiedAt || row.opportunityAt || ADVANCED_STATUSES.has(row.cardStatus ?? "")) card.positive = true;
    cards.set(row.cardId, card);
  }
  const sent: CardOutcome[] = [...cards.values()].filter((card) => card.sent).map((card) => ({ cardId: card.cardId, sector: card.sector, positive: card.positive, replied: card.replied, fitScore: card.fitScore, breakdown: card.breakdown }));
  const weight = options.plainReplyWeight ?? 0;
  const bySector: Record<string, SectorTally> = {};
  const total: SectorTally = { sends: 0, positive: 0, replied: 0 };
  for (const card of sent) {
    const credit = card.positive ? 1 : card.replied ? weight : 0;
    total.sends += 1; total.positive += credit; total.replied += card.replied ? 1 : 0;
    if (!card.sector) continue;
    const entry = (bySector[card.sector] ??= { sends: 0, positive: 0, replied: 0 });
    entry.sends += 1; entry.positive += credit; entry.replied += card.replied ? 1 : 0;
  }
  return { total, bySector, cards: sent };
}

/** Pseudo-positives each sector starts with at the overall rate; more means slower to move. */
export const SECTOR_PRIOR_POSITIVES = 5;
/** No learning until the whole sample has at least this many positives, because the overall rate is itself noise before that. */
export const MIN_POSITIVES_TO_LEARN = 5;

/**
 * Learn which sectors reply: each sector's positive rate, shrunk toward the overall rate by
 * SECTOR_PRIOR_POSITIVES pseudo-positives, as a multiplier between 0.7 and 1.5. Empty until there are
 * MIN_POSITIVES_TO_LEARN positives overall. Takes listOutcomes().bySector, or per-send rows.
 */
export function sectorWeights(outcomes: Record<string, { sends: number; positive: number }> | Array<{ sector: string; positive: boolean | number }>) {
  let tallies: Record<string, { sends: number; positive: number }>;
  if (Array.isArray(outcomes)) {
    tallies = {};
    for (const outcome of outcomes) {
      const entry = (tallies[outcome.sector] ??= { sends: 0, positive: 0 });
      entry.sends += 1;
      entry.positive += Number(outcome.positive);
    }
  } else tallies = outcomes;
  const entries = Object.entries(tallies);
  const sends = entries.reduce((sum, [, entry]) => sum + entry.sends, 0);
  const positives = entries.reduce((sum, [, entry]) => sum + entry.positive, 0);
  const weights: Record<string, number> = {};
  if (!sends || positives < MIN_POSITIVES_TO_LEARN) return weights;
  const overall = positives / sends;
  const k = SECTOR_PRIOR_POSITIVES;
  for (const [sector, entry] of entries) {
    if (!sector || !entry.sends) continue;
    const rate = (entry.positive + k) / (entry.sends + k / overall);
    weights[sector] = Math.min(1.5, Math.max(0.7, rate / overall));
  }
  return weights;
}

/** A group in the fit report; `tooSmall` marks fewer than 10 replies, too few to read anything into. */
export type OutcomeGroup = { sends: number; replies: number; positive: number; tooSmall: boolean };
export const FIT_BANDS = ["below 55", "55-69", "70+"] as const;
const MIN_REPLIES_TO_READ = 10;

/**
 * Measurement only: sends, replies and positives by fit band and by whether each criterion earned points.
 * Rows without a fit score are left out. Nothing here changes minFit or the caps.
 */
export function fitOutcomes(rows: Array<{ fitScore: number | null; breakdown: Partial<Record<AiFitCriterion, number>> | null; classification?: string | null; positive?: boolean; replied?: boolean }>) {
  const group = (): OutcomeGroup => ({ sends: 0, replies: 0, positive: 0, tooSmall: true });
  const add = (target: OutcomeGroup, replied: boolean, positive: boolean) => { target.sends += 1; if (replied) target.replies += 1; if (positive) target.positive += 1; };
  const total = group();
  const bands = FIT_BANDS.map((band) => ({ band, ...group() }));
  const criteria = Object.fromEntries((Object.keys(AI_FIT_MAX) as AiFitCriterion[]).map((criterion) => [criterion, { withPoints: group(), without: group() }])) as Record<AiFitCriterion, { withPoints: OutcomeGroup; without: OutcomeGroup }>;
  for (const row of rows) {
    if (row.fitScore === null || !Number.isFinite(row.fitScore)) continue;
    const label = (row.classification ?? "").toLowerCase();
    const positive = row.positive ?? (POSITIVE_CLASSIFICATIONS as readonly string[]).includes(label);
    const replied = row.replied ?? (positive || (REPLIED_CLASSIFICATIONS as readonly string[]).includes(label));
    add(total, replied, positive);
    add(bands[row.fitScore < 55 ? 0 : row.fitScore < 70 ? 1 : 2], replied, positive);
    for (const criterion of Object.keys(criteria) as AiFitCriterion[]) add((row.breakdown?.[criterion] ?? 0) > 0 ? criteria[criterion].withPoints : criteria[criterion].without, replied, positive);
  }
  const mark = (target: OutcomeGroup) => { target.tooSmall = target.replies < MIN_REPLIES_TO_READ; };
  mark(total);
  bands.forEach(mark);
  for (const split of Object.values(criteria)) { mark(split.withPoints); mark(split.without); }
  return { total, bands, criteria };
}
