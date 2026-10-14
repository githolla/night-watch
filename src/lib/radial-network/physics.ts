export type Node = { id: string; label: string; type: string; color: string; size: number; sub?: string; group?: string; ring?: boolean };
export type Link = { source: string; target: string; kind?: string };
export type Particle = Node & { x: number; y: number; vx: number; vy: number; fx?: number; fy?: number; hub: boolean };
export type Simulation = { nodes: Particle[]; byId: Map<string, Particle>; links: Link[]; adjacency: Map<string, Set<string>>; radius: number; cx: number; cy: number; alpha: number; rootId?: string };
export function createSimulation(nodes: Node[], links: Link[], width: number, height: number, rootId?: string): Simulation {
  let seed = 42;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const radius = Math.min(width, height) * .47, cx = width / 2, cy = height / 2;
  const largest = Math.max(0, ...nodes.filter(n => !n.ring).map(n => n.size));
  const particles: Particle[] = nodes.map(n => ({ ...n, x: cx, y: cy, vx: 0, vy: 0, hub: !n.ring && n.size >= Math.max(9, largest * .8) }));
  const byId = new Map(particles.map(n => [n.id, n]));
  const hubs = particles.filter(n => n.hub && n.id !== rootId), ring = particles.filter(n => n.ring);
  hubs.forEach((n, i) => { const angle = -Math.PI / 2 + i * Math.PI * 2 / hubs.length; n.x = cx + Math.cos(angle) * radius * (rootId ? .8 : .42); n.y = cy + Math.sin(angle) * radius * (rootId ? .8 : .42); });
  ring.forEach((n, i) => { const angle = -Math.PI / 2 + i * Math.PI * 2 / ring.length; const r = radius * (i % 2 ? .965 : 1); n.x = n.fx = cx + Math.cos(angle) * r; n.y = n.fy = cy + Math.sin(angle) * r; });
  particles.filter(n => !n.ring && !n.hub).forEach(n => { const hub = n.group ? byId.get(n.group) : undefined; n.x = (hub?.x ?? cx) + (random() - .5) * radius * .4; n.y = (hub?.y ?? cy) + (random() - .5) * radius * .4; });
  const root = rootId ? byId.get(rootId) : undefined; if (root) { root.x = root.fx = cx; root.y = root.fy = cy; }
  const adjacency = new Map(particles.map(n => [n.id, new Set<string>()]));
  const validLinks = links.filter(l => byId.has(l.source) && byId.has(l.target));
  validLinks.forEach(l => { adjacency.get(l.source)!.add(l.target); adjacency.get(l.target)!.add(l.source); });
  return { nodes: particles, byId, links: validLinks, adjacency, radius, cx, cy, alpha: 1, rootId };
}
export function step(sim: Simulation, hidden: Set<string>) {
  if (sim.alpha < .004) return;
  const nodes = sim.nodes.filter(n => !hidden.has(n.type));
  for (const link of sim.links) {
    const a = sim.byId.get(link.source)!, b = sim.byId.get(link.target)!;
    if (hidden.has(a.type) || hidden.has(b.type)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.max(.1, Math.hypot(dx, dy));
    const tiny = Math.min(a.size, b.size) <= 2.5, rest = tiny ? 12 + Math.max(a.size, b.size) * 2 : 80;
    const f = (d - rest) / d * (tiny ? .18 : .08) * sim.alpha;
    const share = b.size / (a.size + b.size);
    if (a.fx === undefined) { a.vx += dx * f * share; a.vy += dy * f * share; }
    if (b.fx === undefined) { b.vx -= dx * f * (1 - share); b.vy -= dy * f * (1 - share); }
  }
  const free = nodes.filter(n => !n.ring);
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const a = free[i], b = free[j]; let dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) > 170 || Math.abs(dy) > 170) continue;
    if (dx === 0 && dy === 0) { dx = .01; dy = .01; }
    const d = Math.max(.1, Math.hypot(dx, dy)); if (d > 170) continue;
    let f = (a.size * b.size * 2.4 + 1.5) * sim.alpha / (d * d) * (a.hub && b.hub ? 7 : 1);
    const overlap = a.size + b.size + 5 - d; if (overlap > 0) f += overlap * .3 * sim.alpha;
    const x = dx / d * f, y = dy / d * f;
    if (a.fx === undefined) { a.vx -= x; a.vy -= y; } if (b.fx === undefined) { b.vx += x; b.vy += y; }
  }
  for (const n of nodes) {
    if (n.fx !== undefined && n.fy !== undefined) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
    const gravity = .012 * (1 + n.size / 12) * sim.alpha;
    n.vx = (n.vx + (sim.cx - n.x) * gravity) * .5; n.vy = (n.vy + (sim.cy - n.y) * gravity) * .5;
    n.x += n.vx; n.y += n.vy;
    const dx = n.x - sim.cx, dy = n.y - sim.cy, d = Math.hypot(dx, dy), limit = sim.radius * (n.hub ? sim.rootId ? .8 : .6 : .84);
    if (d > limit) { const pull = (d - limit) * .5 / d; n.x -= dx * pull; n.y -= dy * pull; }
  }
  sim.alpha *= .985;
}
export function hitTest(sim: Simulation, hidden: Set<string>, x: number, y: number, k: number): Particle | null {
  let result: Particle | null = null, nearest = Infinity;
  for (const n of sim.nodes) { if (hidden.has(n.type)) continue; const d = Math.hypot(x - n.x, y - n.y); if (d <= Math.max(n.size, 4) + 3 / k && d < nearest) { result = n; nearest = d; } }
  return result;
}
export function zoomAt(view: { x: number; y: number; k: number }, x: number, y: number, delta: number) {
  const k = Math.max(.4, Math.min(4.5, view.k * Math.exp(-delta * .0012)));
  return { x: x - (x - view.x) * k / view.k, y: y - (y - view.y) * k / view.k, k };
}
