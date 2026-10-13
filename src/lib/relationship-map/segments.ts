import type { Company, RelationshipGraph } from "./graph.ts";
export type SegmentFilters = { industry: string; revenue: string; employees: string; status: string; owner: string; stage: string };
export const ALL_SEGMENTS: SegmentFilters = { industry: "", revenue: "", employees: "", status: "", owner: "", stage: "" };
export const revenueBands = [{ value: "under10", label: "Under $10M" }, { value: "10to50", label: "$10M to $50M" }, { value: "50to100", label: "$50M to $100M" }, { value: "100to1000", label: "$100M to $1B" }, { value: "over1000", label: "$1B and above" }, { value: "unknown", label: "Unknown revenue" }];
export function revenueBand(company: Company) { const value = company.revenueUsdM; return value == null ? "unknown" : value < 10 ? "under10" : value < 50 ? "10to50" : value < 100 ? "50to100" : value < 1000 ? "100to1000" : "over1000"; }
export function matchesSegment(company: Company, filters: SegmentFilters) {
  return (!filters.industry || (company.vertical || "Unknown") === filters.industry) && (!filters.revenue || revenueBand(company) === filters.revenue) && (!filters.employees || (company.employee_range || "Unknown") === filters.employees) && (!filters.status || company.status === filters.status) && (!filters.owner || (company.outreach_owner || "Unassigned") === filters.owner) && (!filters.stage || (company.outreach_stage || "Not recorded") === filters.stage);
}
export function segmentGraph(graph: RelationshipGraph, companies: Company[], filters: SegmentFilters) {
  const companyIds = new Set(companies.filter((company) => matchesSegment(company, filters)).map((company) => company.id));
  const ids = new Set(graph.nodes.filter((node) => node.companyId && companyIds.has(node.companyId) && node.kind !== "source" && node.kind !== "seat").map((node) => node.id));
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    const target = byId.get(edge.to);
    if (ids.has(edge.from) && (target?.kind === "source" || target?.kind === "seat")) ids.add(edge.to);
    const origin = byId.get(edge.from);
    if (ids.has(edge.to) && (origin?.kind === "source" || origin?.kind === "seat")) ids.add(edge.from);
  }
  return { ...graph, nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}
