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

/**
 * Companies the offer cannot be sold to, because they sell it themselves.
 *
 * "We build and run that work so you don't hire for it" IS the managed-services pitch, and the AI/data
 * consultancy pitch, and what a staffing firm is for. An audit of the reach-out list found 171 of 576 —
 * 29.7%, 120 of them first-wave — were firms of exactly that kind: Quantiphi, Fractal Analytics, Tredence,
 * phData, Blend360, Datavail, Vaco, Cielo, Bullhorn, and most of the IT-services and consulting verticals.
 *
 * Judged on the recorded vertical and sub-segment only — never guessed from a company name — so the rule is
 * auditable and reversible. Kept as a predicate rather than an edit to the generated file: the cut is a
 * decision about the offer, and it should be visible as one.
 */
const SELLS_THIS_SERVICE_VERTICAL = /^(IT services|Consulting firms)$/i;
const SELLS_THIS_SERVICE_SUBSEGMENT = /\b(staffing|recruit\w*|rpo|talent (?:solutions|intelligence|acquisition))\b|\b(?:ai|a\.i\.|machine learning|ml|data(?: science| engineering| analytics| platform| virtualization)?)\b[^,]{0,30}\b(?:consult\w*|advisory|services|software|platform|engineering)\b|\b(?:analytics|business intelligence)\b[^,]{0,20}\b(?:software|platform|vendor)\b|\bmanaged (?:data|analytics) services\b/i;

// A sub-segment describing a data / analytics / AI PRODUCT. These are not consultancies, so the vertical
// and services rules miss them, but "we build the reporting so you don't hire for it" still lands badly on
// a company whose product IS the reporting.
const SELLS_THIS_SERVICE_PRODUCT = /\b(analytics|data platform|data warehous\w*|data & ai|data and ai|revenue ai|talent intelligence|business intelligence|predictive model\w*|ai platform|ai software|machine learning platform)\b/i;

export function sellsThisService(vertical: string, subSegment: string): boolean {
  return SELLS_THIS_SERVICE_VERTICAL.test((vertical ?? "").trim())
    || SELLS_THIS_SERVICE_SUBSEGMENT.test(subSegment ?? "")
    || SELLS_THIS_SERVICE_PRODUCT.test(subSegment ?? "");
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
  /** True when the company sells this service itself, so the pitch cannot land however good the fit looks. */
  sellsThisService: boolean;
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
    // Tier says the company is the right size and shape; this says the pitch can actually land there.
    outreach: isOutreachTier(cut.tier) && !sellsThisService(vertical, subSegment),
    sellsThisService: sellsThisService(vertical, subSegment),
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
