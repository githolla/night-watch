/** What tonight's list build did, for Settings. Pure, so a plain node test can import it. */

export const SKIP_BUCKETS = [
  "low fit", "not an AI fit", "revenue out of range", "no named buyer", "rejected", "excluded sector", "copy failed",
  "research failed", "email or verify", "buyer source not seen", "prepare", "sourcing", "other",
] as const;
export type SkipBucket = (typeof SKIP_BUCKETS)[number];
export type Skip = { domain: string; reason: string };

// First match wins, so the specific patterns come before the broad "email or verify" one.
const PATTERNS: Array<[SkipBucket, RegExp]> = [
  ["research failed", /^research failed/i],
  ["sourcing", /^sourcing|could not save new companies/i],
  ["prepare", /^(could not )?prepar/i],
  ["low fit", /^AI fit \d+ is below/i],
  ["not an AI fit", /^not an AI fit/i],
  ["revenue out of range", /^revenue\b/i],
  ["no named buyer", /is not a person's name|no (current )?(senior leader|named buyer|buyer)\b/i],
  ["buyer source not seen", /buyer('s)? (source|page)|not (seen|returned) by the search|source was not seen/i],
  ["rejected", /^rejected:/i],
  ["excluded sector", /excluded sector|^excluded\b/i],
  ["copy failed", /^copy failed|^workflow |^repair (failed|did not)/i],
  ["email or verify", /email|address|deliverable|mail server|hunter|verif|\bmx\b/i],
];

export function skipBucket(reason: string): SkipBucket {
  const text = reason.trim();
  return PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
}

/** The { domain, reason } entries a list saved in reachout_lists.errors; plain strings are kept too. */
export function skipEntries(errors: unknown): Skip[] {
  if (!Array.isArray(errors)) return [];
  const out: Skip[] = [];
  for (const item of errors) {
    if (typeof item === "string" && item.trim()) out.push({ domain: "", reason: item.trim() });
    else if (item && typeof item === "object" && "reason" in item) {
      const { domain, reason } = item as { domain?: unknown; reason?: unknown };
      if (typeof reason === "string" && reason.trim()) out.push({ domain: typeof domain === "string" ? domain : "", reason: reason.trim() });
    }
  }
  return out;
}

/** Skip counts by bucket, largest first, leaving out empty buckets. */
export function bucketSkips(errors: unknown): Array<{ bucket: SkipBucket; count: number }> {
  const counts = new Map<SkipBucket, number>();
  for (const skip of skipEntries(errors)) counts.set(skipBucket(skip.reason), (counts.get(skipBucket(skip.reason)) ?? 0) + 1);
  return SKIP_BUCKETS.filter((bucket) => counts.has(bucket)).map((bucket) => ({ bucket, count: counts.get(bucket)! })).sort((a, b) => b.count - a.count);
}

/** Lowest, median and highest AI-fit score of the kept rows; older rows without a score are left out. */
export function fitRange(rows: unknown): { min: number; median: number; max: number } | null {
  if (!Array.isArray(rows)) return null;
  const scores = rows
    .map((row) => (row && typeof row === "object" && "aiFit" in row ? (row as { aiFit?: { score?: unknown } }).aiFit?.score : undefined))
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score))
    .sort((a, b) => a - b);
  if (!scores.length) return null;
  const middle = Math.floor(scores.length / 2);
  const median = scores.length % 2 ? scores[middle] : Math.round((scores[middle - 1] + scores[middle]) / 2);
  return { min: scores[0], median, max: scores.at(-1)! };
}

export type ListReportInput = { status: string; rows: unknown; attempts: number | null; errors: unknown; announced_at: string | null; summary_posted_at?: string | null; sent_count: number | null; held_count: number | null };
export type ListReport = {
  status: string; companies: number; sent: number; held: number; attempts: number; target: number;
  fit: { min: number; median: number; max: number } | null; announcedAt: string | null; summaryPostedAt: string | null;
  skipBuckets: Array<{ bucket: SkipBucket; count: number }>; skips: Skip[];
};

/** One seat's list for Settings: progress against the research target, fit spread, messages and skips. */
export function listReport(list: ListReportInput, target: number): ListReport {
  return {
    status: list.status, companies: Array.isArray(list.rows) ? list.rows.length : 0, sent: Number(list.sent_count ?? 0), held: Number(list.held_count ?? 0),
    attempts: Number(list.attempts ?? 0), target, fit: fitRange(list.rows), announcedAt: list.announced_at ?? null, summaryPostedAt: list.summary_posted_at ?? null,
    skipBuckets: bucketSkips(list.errors), skips: skipEntries(list.errors).slice(-50),
  };
}

/** The night's spend across both seats, because the budget is shared. */
export function nightSpend(lists: Array<{ cost_usd: unknown }>, budgetUsd: number) {
  const total = lists.reduce((sum, list) => sum + (Number(list.cost_usd) || 0), 0);
  return { costUsd: Number(total.toFixed(2)), budgetUsd };
}
