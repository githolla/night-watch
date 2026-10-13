import type { Company, Point } from "./graph.ts";
import type { Camera } from "./view.ts";
export function canvasPoint(point: Point, rect: { left: number; top: number; width: number; height: number }) {
  const unit = Math.min(rect.width / 1600, rect.height / 1160);
  return { x: (point.x - rect.left - (rect.width - 1600 * unit) / 2) / unit, y: (point.y - rect.top - (rect.height - 1160 * unit) / 2) / unit };
}
export function centeredCamera(point: Point, scale = 0.85): Camera { return { x: 800 - point.x * scale, y: 580 - point.y * scale, scale }; }
export function minimapGeometry(points: Record<string, Point>) {
  const values = Object.values(points);
  const bounds = values.reduce((box, point) => ({ minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x), minY: Math.min(box.minY, point.y), maxY: Math.max(box.maxY, point.y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  if (!values.length) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(180 / Math.max(1, bounds.maxX - bounds.minX + 600), 100 / Math.max(1, bounds.maxY - bounds.minY + 400));
  return { x: 100 - (bounds.minX + bounds.maxX) / 2 * scale, y: 60 - (bounds.minY + bounds.maxY) / 2 * scale, scale };
}

export function orderedCompanies(companies: Company[]) {
  const batch = (company: Company) => company.outreachList?.startsWith("Today's") ? 0 : company.outreachList === "First 25" ? 1 : company.outreachList === "Next 25" ? 2 : 3;
  return [...companies].sort((a, b) => batch(a) - batch(b) || (a.listPosition ?? Infinity) - (b.listPosition ?? Infinity) || a.name.localeCompare(b.name));
}
