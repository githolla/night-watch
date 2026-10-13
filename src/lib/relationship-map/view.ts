import { z } from "zod";
import { layers, type Layer, type MapNode, type Point, type RelationshipGraph } from "./graph.ts";
export const layerDesign: Record<Layer, { label: string; color: string; description: string }> = {
  company: { label: "Company", color: "#efb45c", description: "The business at the center of the records" },
  person: { label: "Contacts", color: "#ac9ff2", description: "People recorded at the company" },
  draft: { label: "Messages", color: "#6eb9f5", description: "Prepared email and outreach cards" },
  outreach: { label: "Reach-outs", color: "#75d6be", description: "Actual recorded sends" },
  reply: { label: "Replies", color: "#e6a6ce", description: "Recorded replies and classifications" },
  bounce: { label: "Bounces", color: "#f1857e", description: "Delivery failures needing recovery" },
  signal: { label: "Research", color: "#e1c779", description: "Company-specific research signals" },
  job: { label: "Hiring", color: "#8cd0e4", description: "Job postings and workflow inputs" },
  post: { label: "Posts", color: "#c0b3dd", description: "Recorded employee posts" },
  discovery: { label: "Discoveries", color: "#8dbb91", description: "Inputs with human-confirmed company identity" },
  source: { label: "Sources", color: "#8498aa", description: "Original evidence URLs" },
  seat: { label: "Senders", color: "#e6e7eb", description: "The seats that sent connected messages" },
};
const nodeSchema = z.object({ id: z.string(), kind: z.enum(layers), label: z.string(), subtitle: z.string(), detail: z.string(), status: z.string(), companyId: z.string().nullable(), href: z.string().nullable(), sourceUrl: z.string().nullable(), at: z.string().nullable(), facts: z.array(z.object({ label: z.string(), value: z.string() })) });
export const graphSchema = z.object({ nodes: z.array(nodeSchema), edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), label: z.string() })), warnings: z.array(z.string()), companyId: z.string().nullable(), loadedAt: z.string() });
export const companiesSchema = z.array(z.object({ id: z.string(), name: z.string(), domain: z.string(), status: z.string(), outreach_stage: z.string().nullable().optional(), outreach_owner: z.string().nullable().optional(), vertical: z.string().nullable().optional(), employee_range: z.string().nullable().optional(), revenueUsdM: z.number().nullable().optional(), revenueStatus: z.string().nullable().optional(), revenueYear: z.number().nullable().optional(), revenueSource: z.string().nullable().optional() }));
export type Camera = { x: number; y: number; scale: number };
export const DEFAULT_CAMERA: Camera = { x: 800, y: 580, scale: 0.78 };
export function zoomCamera(camera: Camera, factor: number, anchor: Point): Camera { const scale = Math.min(3.5, Math.max(0.005, camera.scale * factor)); const ratio = scale / camera.scale; return { x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio, scale }; }
export function edgePath(from: Point, to: Point) { const middle = { x: (from.x + to.x) / 2 + (to.y - from.y) * 0.1, y: (from.y + to.y) / 2 - (to.x - from.x) * 0.1 }; return `M${from.x},${from.y} Q${middle.x},${middle.y} ${to.x},${to.y}`; }
export function shortLabel(node: MapNode, limit = 30) { const label = node.kind === "outreach" || node.kind === "reply" || node.kind === "bounce" ? `${node.label} · ${node.subtitle}` : node.label; return label.length > limit ? `${label.slice(0, limit - 1)}…` : label; }
export function nodeRadius(node: MapNode) { return node.kind === "company" ? 42 : node.kind === "person" ? 13 : node.kind === "source" ? 5 : node.kind === "seat" ? 10 : node.kind === "draft" ? 11 : 8; }
export function filterGraph(graph: RelationshipGraph, enabled: Set<Layer>, query: string, isolated: Set<string> | null) {
  const matches = query.trim().toLowerCase();
  const ids = new Set(graph.nodes.filter((node) => (node.kind === "company" || enabled.has(node.kind)) && (!isolated || isolated.has(node.id))).map((node) => node.id));
  if (matches) { const found = new Set(graph.nodes.filter((node) => `${node.label} ${node.subtitle} ${node.status} ${node.facts.map((fact) => fact.value).join(" ")}`.toLowerCase().includes(matches)).map((node) => node.id)); const related = new Set(found); for (const edge of graph.edges) if (found.has(edge.from) || found.has(edge.to)) { related.add(edge.from); related.add(edge.to); } for (const node of graph.nodes) if (related.has(node.id) && node.companyId) related.add(`company:${node.companyId}`); for (const node of graph.nodes) if (!related.has(node.id)) ids.delete(node.id); }
  return { ...graph, nodes: graph.nodes.filter((node) => ids.has(node.id)), edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
}

export type LabelBox = { x: number; y: number; width: number };
export function placeLabels(nodes: MapNode[], points: Record<string, Point>): Record<string, LabelBox> {
  const root = Object.entries(points).find(([id]) => id.startsWith("company:"))?.[1] ?? { x: 0, y: 0 };
  const boxes = [{ x: root.x - 95, y: root.y - 95, width: 190, height: 190 }, { x: root.x - 240, y: root.y + 60, width: 480, height: 90 }];
  const placed: Record<string, LabelBox> = {};
  const overlaps = (box: { x: number; y: number; width: number; height: number }) => boxes.some((other) => box.x < other.x + other.width + 6 && box.x + box.width + 6 > other.x && box.y < other.y + other.height + 6 && box.y + box.height + 6 > other.y);
  for (const node of nodes) {
    const point = points[node.id]; if (!point || node.kind === "company") continue;
    const width = Math.max(80, shortLabel(node).length * 10.5 + 20); const radius = nodeRadius(node);
    let chosen = { x: point.x + radius + 10, y: point.y - 18, width, height: 34 };
    let found = false;
    for (const side of [point.x >= 0 ? 1 : -1, point.x >= 0 ? -1 : 1]) {
      for (const offset of [0, 44, -44, 88, -88, 132, -132, 176, -176]) {
        const box = { x: side === 1 ? point.x + radius + 10 : point.x - radius - 10 - width, y: point.y - 18 + offset, width, height: 34 };
        if (!overlaps(box)) { chosen = box; found = true; break; }
      }
      if (found) break;
    }
    boxes.push(chosen); placed[node.id] = { x: chosen.x - point.x, y: chosen.y - point.y, width };
  }
  return placed;
}

export function fitCamera(points: Record<string, Point>): Camera {
  const values = Object.values(points); if (!values.length) return DEFAULT_CAMERA;
  const bounds = values.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x), minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  const minX = bounds.minX - 250, maxX = bounds.maxX + 250, minY = bounds.minY - 180, maxY = bounds.maxY + 180;
  const scale = Math.min(0.78, 1450 / Math.max(1, maxX - minX), 1000 / Math.max(1, maxY - minY));
  return { x: 800 - (minX + maxX) / 2 * scale, y: 580 - (minY + maxY) / 2 * scale, scale };
}
