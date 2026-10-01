import { z } from "zod";

/**
 * How good a candidate a company is for an AI implementation with Nine-67, 0 to 100.
 *
 * The research model only gathers dated, sourced facts; this file decides what they are worth, so a score
 * can never be asserted without evidence and every point traces to a link. The criteria follow the
 * product's own thesis (docs/scoring.md): companies hiring people for work a system could do, with
 * repetitive operations at scale, in a period of change, led by people open to technology, and with
 * systems already in place to build on.
 */
const https = z.string().url().refine((url) => url.startsWith("https://"), "must be an https link");
const dated = z.string().nullable().default(null);

export const aiFitEvidence = z.object({
  /** Open roles doing coordination, scheduling, dispatch, estimating, admin, data or automation work. */
  hiring: z.array(z.object({ title: z.string().min(3), url: https, postedDate: dated })).default([]),
  /** Locations or branches, and field workforce, fleet or volume, with the page that shows it. */
  scale: z.object({ locations: z.number().int().nonnegative().nullable().default(null), fieldWorkforce: z.number().int().nonnegative().nullable().default(null), highVolume: z.string().nullable().default(null), url: https.nullable().default(null) }).nullable().default(null),
  /** Acquisitions, new locations, a new CEO, COO or operations leader, or new investment. */
  change: z.array(z.object({ kind: z.string().min(3), fact: z.string().min(10), date: dated, url: https })).default([]),
  /** Leaders speaking publicly about AI, automation, technology or efficiency; technology or ops-tech roles. */
  techOpenness: z.array(z.object({ fact: z.string().min(10), date: dated, url: https })).default([]),
  /** Named business systems: field service, ERP, CRM, estimating, routing software, or a customer portal. */
  systems: z.array(z.object({ name: z.string().min(2), url: https })).default([]),
  /** Reasons this is not a fit: a software or IT business, a large in-house AI or engineering team, closing. */
  disqualifiers: z.array(z.string()).default([]),
});
export type AiFitEvidence = z.infer<typeof aiFitEvidence>;

export type AiFitReason = { criterion: AiFitCriterion; points: number; text: string; url: string | null };
export type AiFitCriterion = "hiring" | "scale" | "change" | "techOpenness" | "systems";
export type AiFit = { score: number; breakdown: Record<AiFitCriterion, number>; reasons: AiFitReason[]; disqualified: string | null; summary: string };

export const AI_FIT_MAX: Record<AiFitCriterion, number> = { hiring: 25, scale: 20, change: 20, techOpenness: 20, systems: 15 };

const DAY = 86_400_000;
function ageDays(date: string | null, now: number) {
  if (!date) return null;
  const time = Date.parse(date.length === 10 ? `${date}T00:00:00Z` : date);
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / DAY));
}
/** Undated evidence still counts, at a discount; anything older than its window does not count at all. */
function freshness(date: string | null, now: number, window: number) {
  const age = ageDays(date, now);
  if (age === null) return 0.5;
  if (age > window) return 0;
  return age <= window / 2 ? 1 : 0.7;
}

/** The hires where Nine-67 would build the system instead (docs/scoring.md, target job families). */
// Stems, so no trailing word boundary: "dispatch" must match Dispatcher, "schedul" Scheduling.
const AUTOMATABLE_ROLE = /\b(dispatch|schedul|coordinat|estimat|quot|admin|clerk|billing|invoic|payable|receivable|bookkeep|data|report|analyst|automat|process|system|crm|erp|customer service|office manager|order entry|purchas|procure|operations specialist)/i;

export function aiFitScore(raw: unknown, options: { now?: Date } = {}): AiFit {
  const evidence = aiFitEvidence.parse(raw);
  const now = (options.now ?? new Date()).getTime();
  const reasons: AiFitReason[] = [];

  let hiring = 0;
  for (const role of evidence.hiring.filter((item) => AUTOMATABLE_ROLE.test(item.title)).slice(0, 4)) {
    const points = Math.round(12 * freshness(role.postedDate, now, 90));
    if (!points) continue;
    hiring += points;
    reasons.push({ criterion: "hiring", points, text: `Hiring: ${role.title}`, url: role.url });
  }
  hiring = Math.min(AI_FIT_MAX.hiring, hiring);

  let scale = 0;
  if (evidence.scale?.url) {
    const { locations, fieldWorkforce, highVolume, url } = evidence.scale;
    if ((locations ?? 0) >= 3) { scale += 10; reasons.push({ criterion: "scale", points: 10, text: `${locations} locations`, url }); }
    else if ((locations ?? 0) === 2) { scale += 5; reasons.push({ criterion: "scale", points: 5, text: "2 locations", url }); }
    if ((fieldWorkforce ?? 0) >= 50) { scale += 10; reasons.push({ criterion: "scale", points: 10, text: `${fieldWorkforce} field staff or vehicles`, url }); }
    else if (highVolume?.trim()) { scale += 8; reasons.push({ criterion: "scale", points: 8, text: highVolume.trim(), url }); }
  }
  scale = Math.min(AI_FIT_MAX.scale, scale);

  let change = 0;
  for (const item of evidence.change.slice(0, 3)) {
    const points = Math.round(14 * freshness(item.date, now, 365));
    if (!points) continue;
    change += points;
    reasons.push({ criterion: "change", points, text: item.fact, url: item.url });
  }
  change = Math.min(AI_FIT_MAX.change, change);

  let techOpenness = 0;
  for (const item of evidence.techOpenness.slice(0, 3)) {
    const points = Math.round(12 * freshness(item.date, now, 540));
    if (!points) continue;
    techOpenness += points;
    reasons.push({ criterion: "techOpenness", points, text: item.fact, url: item.url });
  }
  techOpenness = Math.min(AI_FIT_MAX.techOpenness, techOpenness);

  const systemNames = [...new Set(evidence.systems.map((system) => system.name.trim()))].slice(0, 3);
  const systems = Math.min(AI_FIT_MAX.systems, systemNames.length * 8);
  if (systems) reasons.push({ criterion: "systems", points: systems, text: `Runs on ${systemNames.join(", ")}`, url: evidence.systems[0]?.url ?? null });

  const disqualified = evidence.disqualifiers.map((item) => item.trim()).find(Boolean) ?? null;
  const breakdown = { hiring, scale, change, techOpenness, systems };
  const score = disqualified ? 0 : hiring + scale + change + techOpenness + systems;
  const top = [...reasons].sort((a, b) => b.points - a.points).slice(0, 3).map((reason) => reason.text);
  const summary = disqualified ? `Not a fit: ${disqualified}` : `AI fit ${score}/100${top.length ? `: ${top.join("; ")}` : ""}`;
  return { score, breakdown, reasons: reasons.sort((a, b) => b.points - a.points), disqualified, summary };
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

/**
 * Learn which sectors reply. Positive-reply rate per sector against the overall rate, as a multiplier
 * between 0.7 and 1.5, once a sector has at least 20 first emails behind it. Until then every sector is 1.
 */
export function sectorWeights(outcomes: Array<{ sector: string; positive: boolean }>, minSends = 20) {
  const total = outcomes.length;
  const overall = total ? outcomes.filter((outcome) => outcome.positive).length / total : 0;
  const bySector = new Map<string, { sends: number; positive: number }>();
  for (const outcome of outcomes) {
    const entry = bySector.get(outcome.sector) ?? { sends: 0, positive: 0 };
    entry.sends += 1;
    if (outcome.positive) entry.positive += 1;
    bySector.set(outcome.sector, entry);
  }
  const weights: Record<string, number> = {};
  for (const [sector, entry] of bySector) {
    if (entry.sends < minSends || overall === 0) continue;
    weights[sector] = Math.min(1.5, Math.max(0.7, entry.positive / entry.sends / overall));
  }
  return weights;
}
