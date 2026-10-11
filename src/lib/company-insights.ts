import type { OutreachStage } from "./outreach.ts";

/** Plain names for the tiers, so nobody has to know what A1 means. */
export const FIT: Record<string, { label: string; meaning: string }> = {
  A1: { label: "Best fit", meaning: "AI signal, $50M to $1B, PE-backed or a priority industry" },
  A2: { label: "Strong fit", meaning: "AI signal, $50M to $1B" },
  B: { label: "Watching", meaning: "Right size, no AI signal yet; the sweep watches for one" },
  C: { label: "Warm intro only", meaning: "$1B to $5B with an AI signal; only with a warm path" },
  removed: { label: "Removed", meaning: "Too big, PE firms themselves, or duplicates" },
};
export const fitLabel = (tier: string) => FIT[tier]?.label ?? tier;

export type InsightRow = {
  tier: string; outreach: boolean; stage: OutreachStage; industry: string; state: string;
  roles: number; posts: number; contacts: number; verified: number; changedThisWeek: boolean;
};
type Count = { key: string; total: number; onList: number };

/** Counts for each tier, in order, with how many of each are on the reach-out list. */
export function fitBreakdown(rows: InsightRow[]): Count[] {
  return Object.keys(FIT).map((key) => {
    const group = rows.filter((row) => row.tier === key);
    return { key, total: group.length, onList: group.filter((row) => row.outreach).length };
  });
}

/** How far the reach-out list has got, one count per stage, in stage order. */
export function stageFunnel(rows: InsightRow[], order: readonly OutreachStage[]): Array<{ stage: OutreachStage; count: number }> {
  const listed = rows.filter((row) => row.outreach);
  return order.map((stage) => ({ stage, count: listed.filter((row) => row.stage === stage).length }));
}

/** The signals that make a company worth a look now, each counted once per company. */
export function signalCounts(rows: InsightRow[]) {
  return {
    hiring: rows.filter((row) => row.roles > 0).length,
    posts: rows.filter((row) => row.posts > 0).length,
    contacts: rows.filter((row) => row.contacts > 0).length,
    verified: rows.filter((row) => row.verified > 0).length,
    changed: rows.filter((row) => row.changedThisWeek).length,
  };
}

/** The most common values of one field, largest first, with the reach-out share of each. Blank values are left out. */
export function topBy(rows: InsightRow[], field: "industry" | "state", limit = 6): Count[] {
  const tally = new Map<string, Count>();
  for (const row of rows) {
    const key = row[field].trim();
    if (!key) continue;
    const entry = tally.get(key) ?? { key, total: 0, onList: 0 };
    entry.total++;
    if (row.outreach) entry.onList++;
    tally.set(key, entry);
  }
  return [...tally.values()].sort((a, b) => b.total - a.total || a.key.localeCompare(b.key)).slice(0, limit);
}
