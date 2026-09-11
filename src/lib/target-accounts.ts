import { targetAccountData } from "./target-accounts.generated.ts";
import { targetTierData, type TargetTier } from "./target-tiers.generated.ts";

export type { TargetTier };

export const TARGET_ACCOUNT_SOURCE = {
  label: "Nine67 outbound targets above $50M",
  file: "Nine67_Outbound_Targets_50M_plus.csv",
  importedAt: "2026-09-10",
};

/** The reach-out cut applied to the master list: Tier A is contacted, the rest is held or dropped. */
export const TARGET_CUT_SOURCE = {
  label: "Nine67 outbound targets, cut for reach-out",
  file: "Nine67_Outbound_Targets_Cut.xlsx",
  importedAt: "2026-09-11",
};

export const TIER_LABEL: Record<TargetTier, string> = {
  A1: "A1 · Reach out first",
  A2: "A2 · Second wave",
  B: "B · Hold, needs a signal",
  C: "C · Stretch ($1-5B)",
  removed: "Removed",
};

export const TIER_DEFINITION: Record<TargetTier, string> = {
  A1: "$50M-1B revenue, AI signal present, and PE-backed or in a highlighted industry",
  A2: "$50M-1B revenue, AI signal present",
  B: "$50M-1B revenue, no AI signal yet; the sweep watches for one",
  C: "$1-5B revenue, AI signal present; only with a warm path",
  removed: "$5B+, PE firms themselves, $1-5B with no signal, duplicates",
};

/** Tiers whose companies are on the reach-out list. */
export const OUTREACH_TIERS: readonly TargetTier[] = ["A1", "A2"];
export function isOutreachTier(tier: TargetTier) {
  return OUTREACH_TIERS.includes(tier);
}

export type TargetAccount = {
  rank: number;
  name: string;
  domain: string;
  revenueEstimateUsdM: number | null;
  revenueBand: string;
  employees: number | null;
  vertical: string;
  subSegment: string;
  hqCity: string;
  hqState: string;
  ownership: string;
  peSponsor: string;
  ceo: string;
  targetTitles: string[];
  aiSignal: string;
  sourceUrl: string;
  notes: string;
  alsoIn: string;
  tier: TargetTier;
  /** True for Tier A: the only companies Night Watch drafts outreach for. */
  outreach: boolean;
  /** Why the cut removed the company, when it did. */
  dropReason: string;
};

function domainFromWebsite(website: string) {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

const tierByDomain = new Map(targetTierData.map(([website, tier, dropReason]) => [website, { tier, dropReason }]));

export const targetAccounts: TargetAccount[] = targetAccountData.map((record, index) => {
  const [name, vertical, subSegment, hqCity, hqState, website, revenueEstimateUsdM, revenueBand, employees, ownership, peSponsor, ceo, targetTitles, aiSignal, sourceUrl, notes, alsoIn] = record;
  const domain = domainFromWebsite(website);
  // A company the cut does not mention is held, never contacted, until the workbook says otherwise.
  const cut = tierByDomain.get(domain) ?? { tier: "B" as const, dropReason: "" };
  return {
    rank: index + 1,
    name,
    domain,
    revenueEstimateUsdM,
    revenueBand,
    employees,
    vertical,
    subSegment,
    hqCity,
    hqState,
    ownership,
    peSponsor,
    ceo,
    targetTitles,
    aiSignal,
    sourceUrl,
    notes,
    alsoIn,
    tier: cut.tier,
    outreach: isOutreachTier(cut.tier),
    dropReason: cut.dropReason,
  };
});

/** The reach-out list: Tier A, sorted A1 first, then industry, then the file's order. */
export const outreachAccounts: TargetAccount[] = targetAccounts
  .filter((account) => account.outreach)
  .sort((left, right) => left.tier.localeCompare(right.tier) || left.vertical.localeCompare(right.vertical) || left.rank - right.rank);

/** Companies the sync keeps active: everything but the removed tier. */
export const activeTargetAccounts: TargetAccount[] = targetAccounts.filter((account) => account.tier !== "removed");

export const targetAccountByDomain = new Map(targetAccounts.map((account) => [account.domain, account]));

export function employeeRange(employees: number | null) {
  if (employees === null) return "Not reported";
  if (employees < 1000) return "Under 1,000";
  if (employees < 5000) return "1,000–5,000";
  if (employees < 10000) return "5,000–10,000";
  if (employees < 20000) return "10,000–20,000";
  if (employees < 50000) return "20,000–50,000";
  return "50,000+";
}

export function targetAccountRows() {
  return targetAccounts.map((account) => ({
    name: account.name,
    domain: account.domain,
    vertical: account.vertical,
    employee_range: employeeRange(account.employees),
    hq_city: account.hqCity,
    hq_state: account.hqState,
    target_titles: account.targetTitles,
    news_query: `"${account.name}" (AI OR automation OR operations OR data OR hiring)`,
    tier: account.tier,
    drop_reason: account.dropReason || null,
    status: account.tier === "removed" ? ("paused" as const) : ("active" as const),
  }));
}

export function targetAccountRowBatches(size = 200) {
  const rows = targetAccountRows();
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );
}
