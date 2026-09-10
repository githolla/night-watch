import { targetAccountData } from "./target-accounts.generated.ts";

export const TARGET_ACCOUNT_SOURCE = {
  label: "Nine67 outbound targets above $50M",
  file: "Nine67_Outbound_Targets_50M_plus.csv",
  importedAt: "2026-09-10",
};

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
};

function domainFromWebsite(website: string) {
  return website
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

export const targetAccounts: TargetAccount[] = targetAccountData.map((record, index) => {
  const [name, vertical, subSegment, hqCity, hqState, website, revenueEstimateUsdM, revenueBand, employees, ownership, peSponsor, ceo, targetTitles, aiSignal, sourceUrl, notes, alsoIn] = record;
  return {
    rank: index + 1,
    name,
    domain: domainFromWebsite(website),
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
  };
});

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
    status: "active" as const,
  }));
}

export function targetAccountRowBatches(size = 200) {
  const rows = targetAccountRows();
  return Array.from({ length: Math.ceil(rows.length / size) }, (_, index) =>
    rows.slice(index * size, (index + 1) * size),
  );
}
