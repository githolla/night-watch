export const LIST_BUILDERS = [
  { id: "ranked_operators", name: "Proven operating companies", signal: "Published company revenue and operational footprint", focus: "Start with dated industry rankings and first-party annual reports. Find operating businesses with documented revenue and branch, fleet or order-volume evidence.", buyer: "Owner, COO or operations leader", proof: "Dated company-specific revenue source", windowDays: null },
  { id: "hiring_workload", name: "Hiring for work we can improve", signal: "Open internal operations, reporting, CRM or integration roles", focus: "Find companies currently hiring operations analysts, reporting analysts, CRM administrators, business-systems specialists or workflow automation staff. Use live company careers pages or public job boards. Exclude AI product/research and field-trade hires. Hiring is evidence of work, not interest in outsourcing.", buyer: "Operations or business-systems leader responsible for that workflow", proof: "Active job posting with relevant responsibilities", windowDays: 90 },
  { id: "branch_coordination", name: "Multi-location coordination", signal: "Branches, field crews, fleets or repeated service workflows", focus: "Find operators with at least three documented branches, locations or service territories and a specific coordination workflow such as dispatch, quoting, scheduling, invoicing or branch reporting. Do not claim their processes are manual unless a source says so.", buyer: "Regional, field or branch operations leader", proof: "Company location directory or documented operational footprint", windowDays: null },
  { id: "growth_integration", name: "Growth and integration", signal: "Recent expansion, acquisitions or new operating leadership", focus: "Find operating companies with a dated expansion, acquisition by the company, new branches or new operations leadership in the last 180 days. Explain integration work as a hypothesis. An acquired target is not the same entity as its acquiring parent; do not borrow the parent's revenue.", buyer: "Operations or integration leader at the relevant entity", proof: "Dated first-party announcement or attributed reporting", windowDays: 180 },
  { id: "systems_workflows", name: "Named systems and workflow gaps", signal: "Documented CRM, ERP, field-service or reporting systems", focus: "Find operators whose own pages or current job postings name their business systems and a relevant integration, reporting or administrative responsibility. A named system alone does not establish pain. Never use generic industry software adoption as company evidence.", buyer: "Business-systems or operations leader owning the stated process", proof: "Company-specific system and workflow evidence", windowDays: 180 },
  { id: "upper_midmarket", name: "Larger-company operating divisions", signal: "$100M to $1B businesses with a scoped operational use case", focus: "Focus on documented annual company revenue from $100M through $1B. Find a specific division, region, function or branch workflow, not a company-wide AI transformation pitch. Identify the relevant operating leader. Scope revenue to the company being targeted; never substitute a parent's total revenue for a subsidiary or vice versa.", buyer: "Division GM, VP or Director of Operations", proof: "Reported company revenue plus evidence of a scoped operating workflow", windowDays: 180 },
] as const;
export type ListBuilderId = (typeof LIST_BUILDERS)[number]["id"];
export function buildersForNight(day: number, wave = 0) {
  const focused = LIST_BUILDERS.slice(1);
  const index = ((day + wave) % focused.length + focused.length) % focused.length;
  return [LIST_BUILDERS[0], focused[index]];
}
export function revenueLane(revenue: number | null) {
  return revenue === null ? "unknown" : !Number.isFinite(revenue) || revenue < 10 ? "outside" : revenue <= 100 ? "core" : revenue <= 250 ? "growth" : revenue <= 1000 ? "upper_midmarket" : "outside";
}
export function builderInstructions(day: number, wave = 0) {
  return buildersForNight(day, wave).map((builder) => `Builder ${builder.id}: ${builder.focus}\nRequired source: ${builder.proof}. Buyer role to investigate: ${builder.buyer}.`).join("\n\n");
}
export function diversifiedResearchQueue<T extends { revenue_usd_m: number | null }>(rows: T[], slots: number): T[] {
  const lanes = ["core", "growth", "upper_midmarket", "unknown"];
  const buckets = new Map(lanes.map((lane) => [lane, rows.filter((row) => revenueLane(row.revenue_usd_m) === lane)]));
  const selected: T[] = [];
  while (selected.length < slots && lanes.some((lane) => buckets.get(lane)!.length)) for (const lane of lanes) {
    if (selected.length >= slots) break;
    const row = buckets.get(lane)!.shift(); if (row) selected.push(row);
  }
  return selected;
}
