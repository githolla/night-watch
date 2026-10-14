import type { Company, Layer, Point, RelationshipGraph } from "./graph.ts";
import { fitCamera, type Camera } from "./view.ts";
import { revenueBand, revenueBands } from "./segments.ts";
export type RadialGrouping = "industry" | "revenue" | "list";
export const ringSections: Array<{ id: string; label: string; color: string; kinds: Layer[] }> = [
  { id: "email", label: "EMAIL ADDRESSES", color: "#69ddc0", kinds: ["email"] },
  { id: "source", label: "ORIGINAL SOURCES", color: "#8da7ca", kinds: ["source"] },
  { id: "date", label: "RECORDED DATES", color: "#e4bf75", kinds: ["date"] },
  { id: "outreach", label: "SENT & RESPONSES", color: "#ef928f", kinds: ["outreach", "reply", "bounce", "draft", "seat"] },
  { id: "research", label: "RESEARCH INPUTS", color: "#c4b0ec", kinds: ["signal", "job", "post", "discovery"] },
  { id: "person", label: "CONTACTS", color: "#85bafb", kinds: ["person"] },
];
export function polar(radius: number, angle: number): Point { return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }; }
export function ringArc(radius: number, start: number, end: number) { const a = polar(radius, start), b = polar(radius, end); return `M${a.x},${a.y} A${radius},${radius} 0 ${end - start > Math.PI ? 1 : 0} 1 ${b.x},${b.y}`; }
export function radialLayout(graph: RelationshipGraph, grouping: RadialGrouping = "industry") {
  const points: Record<string, Point> = {};
  const fact = grouping === "industry" ? "Industry" : grouping === "revenue" ? "Revenue" : "Outreach list";
  const companies = graph.nodes.filter((node) => node.kind === "company").sort((a, b) => (a.facts.find((item) => item.label === fact)?.value ?? "Unknown").localeCompare(b.facts.find((item) => item.label === fact)?.value ?? "Unknown", undefined, { numeric: true }) || a.label.localeCompare(b.label));
  for (const [index, company] of companies.entries()) {
    const bands = companies.length > 14 ? 3 : 1;
    const radius = companies.length === 1 ? 0 : bands === 1 ? 420 : 220 + (index % bands) * 180;
    points[company.id] = polar(radius, index * 2 * Math.PI / Math.max(1, companies.length) - Math.PI / 2);
  }
  for (const [sector, section] of ringSections.entries()) {
    const nodes = graph.nodes.filter((node) => section.kinds.includes(node.kind)).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const start = -Math.PI / 2 + sector * Math.PI / 3 + 0.06, end = start + Math.PI / 3 - 0.12;
    const capacity = 28;
    for (const [index, node] of nodes.entries()) {
      const band = Math.floor(index / capacity), size = Math.min(capacity, nodes.length - band * capacity);
      points[node.id] = polar(850 + band * 44, start + (end - start) * ((index % capacity + 0.5) / Math.max(1, size)));
    }
  }
  return points;
}
export function ringRadius(points: Record<string, Point>) { return Object.values(points).reduce((radius, point) => Math.max(radius, Math.hypot(point.x, point.y) + 90), 960); }
export type LeadLens = "all" | "unsent" | "bounces" | "replies" | "missing-email" | "email-review";
export const leadLenses: Array<{ value: LeadLens; label: string }> = [{ value: "all", label: "All leads" }, { value: "unsent", label: "No recorded sends" }, { value: "bounces", label: "Bounces on file" }, { value: "replies", label: "Replies received" }, { value: "missing-email", label: "Missing email" }, { value: "email-review", label: "Review addresses" }];
export function matchesLeadLens(graph: RelationshipGraph, companyId: string, lens: LeadLens) {
  const nodes = graph.nodes.filter((node) => node.companyId === companyId);
  if (lens === "all") return true;
  if (lens === "unsent") return !nodes.some((node) => node.kind === "outreach");
  if (lens === "bounces") return nodes.some((node) => node.kind === "bounce");
  if (lens === "replies") return nodes.some((node) => node.kind === "reply");
  if (lens === "missing-email") return nodes.some((node) => node.kind === "person" && node.facts.some((fact) => fact.label === "Email" && fact.value === "Not found"));
  return nodes.some((node) => node.kind === "email" && !["verified", "do not contact"].includes(node.status));
}

export function radialCamera(points: Record<string, Point>, radius = ringRadius(points)): Camera {
  const bounds = radius + 65;
  return fitCamera({ north: { x: 0, y: -bounds }, south: { x: 0, y: bounds }, east: { x: bounds, y: 0 }, west: { x: -bounds, y: 0 } });
}

export function radialFacets(graph: RelationshipGraph, grouping: RadialGrouping, companies: Company[]) {
  const metadata = new Map(companies.map((company) => [company.id, company]));
  const field = grouping === "industry" ? "Industry" : grouping === "revenue" ? "Revenue" : "Outreach list";
  const hubs = graph.nodes.filter((node) => node.kind === "company").sort((a, b) => (a.facts.find((fact) => fact.label === field)?.value ?? "Unknown").localeCompare(b.facts.find((fact) => fact.label === field)?.value ?? "Unknown", undefined, { numeric: true }) || a.label.localeCompare(b.label));
  const groups = new Map<string, { value: string; label: string; count: number }>();
  for (const node of hubs) {
    const company = metadata.get(node.companyId!); if (!company) continue;
    const value = grouping === "industry" ? company.vertical || "Unknown" : grouping === "revenue" ? revenueBand(company) : company.outreachList || "Not recorded";
    const label = grouping === "revenue" ? revenueBands.find((band) => band.value === value)!.label : value;
    const group = groups.get(value) ?? { value, label, count: 0 }; group.count++; groups.set(value, group);
  }
  let offset = 0;
  return [...groups.values()].map((group) => { const start = -Math.PI / 2 + offset / Math.max(1, hubs.length) * 2 * Math.PI; offset += group.count; const end = -Math.PI / 2 + offset / Math.max(1, hubs.length) * 2 * Math.PI; return { ...group, start, end }; });
}
