import { layers, type Layer, type MapNode, type Point, type RelationshipGraph } from "./graph.ts";
export function fact(node: MapNode, name: string) { return node.facts.find((item) => item.label === name)?.value ?? null; }
export function statusTone(node: MapNode) {
  if (["do not contact", "invalid", "bounced", "delivery failure"].includes(node.status)) return "danger";
  if (["verified", "positive", "replied"].includes(node.status)) return "success";
  if (["unverified", "risky", "catch_all"].includes(node.status)) return "warning";
  return "neutral";
}
export function recordedDate(value: string | null, time = false) {
  if (!value) return "Date not recorded";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(dateOnly ? `${value}T12:00:00Z` : value);
  if (!Number.isFinite(date.getTime())) return "Date not recorded";
  return date.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", ...(time && !dateOnly ? { hour: "numeric", minute: "2-digit" } : { year: "numeric" }) }) + (time && !dateOnly ? " ET" : "");
}
export function dateLabel(node: MapNode) {
  const prefix = node.kind === "outreach" ? "Sent" : node.kind === "reply" ? "Replied" : node.kind === "bounce" ? "Bounced" : node.kind === "draft" ? "Created" : node.kind === "email" ? "Verified" : node.kind === "person" ? "Added" : "Recorded";
  return node.at ? `${prefix} ${recordedDate(node.at, ["outreach", "reply", "bounce", "email"].includes(node.kind))}` : node.kind === "source" ? "Source date not recorded" : "Date not recorded";
}
export function companyStory(graph: RelationshipGraph, companyId: string) {
  const nodes = graph.nodes.filter((node) => node.companyId === companyId && node.kind !== "source");
  const ids = new Set(nodes.map((node) => node.id));
  const sources = graph.nodes.filter((node) => node.kind === "source" && graph.edges.some((edge) => (edge.to === node.id && ids.has(edge.from)) || (edge.from === node.id && ids.has(edge.to))));
  const contacts = nodes.filter((node) => node.kind === "person"), addresses = nodes.filter((node) => node.kind === "email");
  const sent = nodes.filter((node) => node.kind === "outreach");
  const replies = nodes.filter((node) => node.kind === "reply"), bounces = nodes.filter((node) => node.kind === "bounce");
  const events = nodes.filter((node) => node.at).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime());
  return { nodes, sources, contacts, addresses, sent, replies, bounces, events, latest: events[0] ?? null };
}
export function journeyLayout(graph: RelationshipGraph): Record<string, Point> {
  const points: Record<string, Point> = {};
  const columns: Record<Layer, number> = { source: 0, signal: 400, job: 400, post: 400, discovery: 400, company: 0, person: 400, email: 800, draft: 800, outreach: 1200, reply: 1600, bounce: 1600, seat: 1200 };
  const lanes = [["source"], ["signal", "job", "post", "discovery"], ["company"], ["person"], ["email"], ["draft"], ["outreach"], ["reply", "bounce"], ["seat"]];
  for (const lane of lanes) {
    const nodes = graph.nodes.filter((node) => lane.includes(node.kind)).sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    for (const [index, node] of nodes.entries()) points[node.id] = { x: columns[node.kind], y: node.kind === "seat" ? -420 - index * 180 : ["source", "signal", "job", "post", "discovery", "draft"].includes(node.kind) ? 380 + index * 190 : (index - (nodes.length - 1) / 2) * 190 };
  }
  // An address follows its actual contact, keeping multiple contacts visually distinct.
  for (const edge of graph.edges) if (edge.label === "has current address" && points[edge.from] && points[edge.to]) points[edge.to].y = points[edge.from].y;
  return points;
}
export const journeyLanes = [{ x: 0, y: -330, label: "COMPANY" }, { x: 400, y: -330, label: "CONTACTS" }, { x: 800, y: -330, label: "CURRENT EMAIL" }, { x: 1200, y: -330, label: "RECORDED SENDS" }, { x: 1600, y: -330, label: "RESPONSES" }, { x: 0, y: 270, label: "ORIGINAL SOURCES" }, { x: 400, y: 270, label: "RESEARCH & DATES" }, { x: 800, y: 270, label: "PREPARED EMAILS" }];
export function timelineNodes(graph: RelationshipGraph) { return graph.nodes.filter((node) => node.at && !["company", "source", "seat"].includes(node.kind)).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime() || a.id.localeCompare(b.id)); }
export function layerCounts(nodes: MapNode[]) { return Object.fromEntries(layers.map((kind) => [kind, nodes.filter((node) => node.kind === kind).length])) as Record<Layer, number>; }
