"use client";
import { useEffect, useRef, useState } from "react";
import { createSimulation, hitTest, step, zoomAt, type Node, type Link, type Simulation, type Particle } from "@/lib/radial-network/physics";
export type { Node, Link } from "@/lib/radial-network/physics";
export type RadialNetworkProps = { nodes: Node[]; links: Link[]; height: number; theme?: "light" | "dark"; showRing?: boolean; selectedId?: string | null; onSelect: (node: Node | null) => void; hiddenTypes: Set<string>; labels: "auto" | "all"; rootId?: string; centerOn?: { id: string; n: number } };
type View = { x: number; y: number; k: number };
type Tooltip = { node: Node; x: number; y: number };
function render(ctx: CanvasRenderingContext2D, sim: Simulation, view: View, width: number, height: number, hidden: Set<string>, selected: string | null, hover: string | null, showRing: boolean, labels: "auto" | "all", logos: Map<string, HTMLImageElement>, light: boolean) {
  const background = light ? "#fffefc" : "#060a12", ink = light ? "#332e28" : "#e6edf8";
  ctx.clearRect(0, 0, width, height); ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
  const k = view.k, R = sim.radius, cx = sim.cx, cy = sim.cy;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R); glow.addColorStop(0, light ? "rgba(154,106,39,.05)" : "rgba(65,125,220,.10)"); glow.addColorStop(1, light ? "rgba(154,106,39,0)" : "rgba(65,125,220,0)"); ctx.fillStyle = glow; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
  for (const ratio of [.28, .56, .84]) { ctx.beginPath(); ctx.arc(cx, cy, R * ratio, 0, Math.PI * 2); ctx.strokeStyle = light ? ratio === .84 ? "#d5cfc4" : "#e6e0d6" : ratio === .84 ? "#203043" : "#172337"; ctx.lineWidth = .7 / k; ctx.setLineDash(ratio === .84 ? [] : [3 / k, 7 / k]); ctx.stroke(); }
  ctx.setLineDash([]); ctx.strokeStyle = light ? "#d3ccbf" : "#25364c"; ctx.lineWidth = .7 / k;
  for (let i = 0; i < 24; i++) { const a = i * Math.PI / 12; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * R * .9, cy + Math.sin(a) * R * .9); ctx.lineTo(cx + Math.cos(a) * (R * .9 - (i % 6 ? 4 : 10) / k), cy + Math.sin(a) * (R * .9 - (i % 6 ? 4 : 10) / k)); ctx.stroke(); }
  const visible = sim.nodes.filter(n => !hidden.has(n.type) && (showRing || !n.ring));
  if (showRing) {
    const ring = sim.nodes.filter(n => n.ring), groups: Array<{ name: string; color: string; start: number; end: number }> = [];
    ring.forEach((n, i) => { const name = n.sub?.split(" · ")[0] || n.type; const last = groups.at(-1); if (last?.name === name) last.end = i; else groups.push({ name, color: n.color, start: i, end: i }); });
    for (const group of groups) {
      const a = -Math.PI / 2 + (group.start - .4) * 2 * Math.PI / ring.length, b = -Math.PI / 2 + (group.end + .4) * 2 * Math.PI / ring.length;
      if (!visible.some(n => n.ring && (n.sub?.split(" · ")[0] || n.type) === group.name)) continue;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.06, a, b); ctx.strokeStyle = group.color; ctx.globalAlpha = .5; ctx.lineWidth = .8 / k; ctx.stroke(); ctx.globalAlpha = 1;
      const middle = (a + b) / 2, left = Math.sin(middle) > 0, text = group.name.toUpperCase(); ctx.font = `${9 / k}px monospace`;
      const spacing = 1.7 / k, widths = [...text].map(char => ctx.measureText(char).width + spacing), total = widths.reduce((sum, v) => sum + v, 0), r = R * 1.11;
      let offset = -total / 2;
      for (let i = 0; i < text.length; i++) { const angle = middle + (left ? -1 : 1) * (offset + widths[i] / 2) / r; ctx.save(); ctx.translate(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r); ctx.rotate(angle + Math.PI / 2 + (left ? Math.PI : 0)); ctx.fillStyle = group.color; ctx.textAlign = "center"; ctx.fillText(text[i], 0, 0); ctx.restore(); offset += widths[i]; }
    }
  }
  const focus = selected || hover, neighbors = focus ? sim.adjacency.get(focus) : undefined;
  const bright = (n: Particle) => !focus || focus === sim.rootId || n.id === focus || neighbors?.has(n.id);
  const paths = new Map<string, { path: Path2D; color: string; width: number; alpha: number }>();
  for (const link of sim.links) {
    const a = sim.byId.get(link.source)!, b = sim.byId.get(link.target)!;
    if (hidden.has(a.type) || hidden.has(b.type) || (!showRing && (a.ring || b.ring))) continue;
    const focused = focus === a.id || focus === b.id, tiny = Math.min(a.size, b.size) <= 2.5, parent = a.size > b.size ? a : b;
    const color = focused ? parent.color : tiny ? parent.color : light ? "#526678" : "#96aae1", alpha = focused ? .85 : focus && focus !== sim.rootId ? .025 : tiny ? .07 : light ? .24 : .09, lineWidth = focused ? 1.2 : tiny ? .55 : .9;
    const key = `${focused ? "1" : "0"}:${color}:${alpha}:${lineWidth}`; let batch = paths.get(key); if (!batch) { batch = { path: new Path2D(), color, width: lineWidth, alpha }; paths.set(key, batch); } batch.path.moveTo(a.x, a.y); batch.path.lineTo(b.x, b.y);
  }
  for (const [, batch] of [...paths].sort(([a], [b]) => a.localeCompare(b))) { ctx.strokeStyle = batch.color; ctx.globalAlpha = batch.alpha; ctx.lineWidth = batch.width / k; ctx.stroke(batch.path); }
  for (const n of visible) {
    ctx.globalAlpha = bright(n) ? 1 : .16;
    if (n.hub) { ctx.beginPath(); ctx.arc(n.x, n.y, n.size * 2.4, 0, Math.PI * 2); ctx.fillStyle = n.color; ctx.globalAlpha *= .1; ctx.fill(); ctx.globalAlpha = bright(n) ? 1 : .16; ctx.beginPath(); ctx.arc(n.x, n.y, n.size + 3 / k, 0, Math.PI * 2); ctx.strokeStyle = n.color; ctx.lineWidth = .7 / k; ctx.stroke(); }
    ctx.beginPath(); ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2); ctx.fillStyle = n.color; ctx.fill(); ctx.strokeStyle = background; ctx.lineWidth = 1 / k; ctx.stroke();
    const logo = n.logoUrl ? logos.get(n.logoUrl) : undefined;
    if (logo?.complete && logo.naturalWidth > 0) { ctx.save(); ctx.beginPath(); ctx.arc(n.x, n.y, n.size - 1 / k, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = "#fff"; ctx.fillRect(n.x - n.size, n.y - n.size, n.size * 2, n.size * 2); const diameter = (n.size - 2 / k) * 2, ratio = Math.min(diameter / logo.naturalWidth, diameter / logo.naturalHeight); ctx.drawImage(logo, n.x - logo.naturalWidth * ratio / 2, n.y - logo.naturalHeight * ratio / 2, logo.naturalWidth * ratio, logo.naturalHeight * ratio); ctx.restore(); }
    else if (n.hub) { ctx.font = `${8 / k}px monospace`; ctx.fillStyle = light ? ink : "#060a12"; ctx.textAlign = "center"; ctx.fillText(n.label.split(/\s+/).slice(0, 2).map(s => s[0]).join(""), n.x, n.y + 3 / k); }
    if (n.id === focus) { ctx.beginPath(); ctx.arc(n.x, n.y, n.size + 6 / k, 0, Math.PI * 2); ctx.strokeStyle = light ? ink : "#fff"; ctx.setLineDash([3 / k, 3 / k]); ctx.stroke(); ctx.setLineDash([]); }
  }
  type Box = { x: number; y: number; w: number; h: number }; const occupied: Box[] = [];
  const candidates = visible.filter(n => (n.ring && visible.length <= 40) || n.hub || n.id === focus || neighbors?.has(n.id) || (labels === "all" && !n.ring && n.size > 2.5) || (k > 3.2 || !n.ring && (n.size >= 6 ? k > 1.25 : n.size > 2.5 && k > 2.4))).sort((a, b) => Number(b.id === focus) - Number(a.id === focus) || Number(b.hub) - Number(a.hub) || b.size - a.size);
  for (const n of candidates) {
    const label = n.label.length > 32 ? n.label.slice(0, 31) + "…" : n.label; const text = n.hub ? label.toUpperCase() : label;
    ctx.font = `${n.hub ? 600 : 400} ${10 / k}px ${n.hub ? "monospace" : "sans-serif"}`; const w = ctx.measureText(text).width + 12 / k, h = 20 / k, gap = n.size + 8 / k;
    const options: Box[] = [{ x: n.x + gap, y: n.y - h / 2, w, h }, { x: n.x - w / 2, y: n.y + gap, w, h }, { x: n.x - w / 2, y: n.y - gap - h, w, h }, { x: n.x - gap - w, y: n.y - h / 2, w, h }];
    if (n.ring) options.sort((a, b) => Math.hypot(a.x + a.w / 2 - cx, a.y + a.h / 2 - cy) - Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy));
    const box = options.find(a => !occupied.some(b => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y)) ?? (n.id === focus ? options[0] : null); if (!box) continue; occupied.push(box);
    ctx.globalAlpha = bright(n) ? 1 : .16; ctx.textAlign = "left";
    if (n.hub) { ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 3 / k); ctx.fillStyle = light ? "#fffefc" : "#0a1320"; ctx.fill(); ctx.strokeStyle = n.color; ctx.lineWidth = .6 / k; ctx.stroke(); } else { ctx.strokeStyle = background; ctx.lineWidth = 3 / k; ctx.strokeText(text, box.x + 6 / k, box.y + 14 / k); }
    ctx.fillStyle = ink; ctx.fillText(text, box.x + 6 / k, box.y + 14 / k);
  }
  ctx.globalAlpha = 1; ctx.restore();
}
export function RadialNetworkGraph(props: RadialNetworkProps) {
  const container = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), sim = useRef<Simulation | null>(null), view = useRef<View>({ x: 0, y: 0, k: 1 }), latest = useRef(props), hover = useRef<string | null>(null);
  const logos = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => { for (const node of props.nodes) { if (!node.logoUrl || logos.current.has(node.logoUrl)) continue; const image = new Image(); logos.current.set(node.logoUrl, image); image.src = node.logoUrl; } }, [props.nodes]);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  useEffect(() => { latest.current = props; });
  useEffect(() => { if (sim.current) sim.current.alpha = .3; }, [props.hiddenTypes]);
  useEffect(() => { if (sim.current) sim.current.alpha = Math.max(sim.current.alpha, .05); }, [props.selectedId]);
  useEffect(() => {
    const element = container.current, surface = canvas.current; if (!element || !surface) return;
    const ctx = surface.getContext("2d"); if (!ctx) return;
    let width = 0, height = 0, dpr = 1, frame = 0;
    function resize() { if (!element || !surface) return; const nextWidth = element.clientWidth, nextHeight = element.clientHeight; if (!nextWidth || !nextHeight || (width === nextWidth && height === nextHeight)) return; width = nextWidth; height = nextHeight; dpr = Math.min(window.devicePixelRatio || 1, 2); surface.width = Math.round(width * dpr); surface.height = Math.round(height * dpr); sim.current = createSimulation(latest.current.nodes, latest.current.links, width, height, latest.current.rootId); for (let i = 0; i < 220; i++) step(sim.current, latest.current.hiddenTypes); sim.current.alpha = .12; view.current = { x: 0, y: 0, k: 1 }; const target = latest.current.centerOn && sim.current.byId.get(latest.current.centerOn.id); if (target) view.current = { x: width / 2 - target.x * 1.8, y: height / 2 - target.y * 1.8, k: 1.8 }; }
    resize(); const observer = new ResizeObserver(resize); observer.observe(element);
    const draw = () => { const current = sim.current, p = latest.current; if (current) { step(current, p.hiddenTypes); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); render(ctx, current, view.current, width, height, p.hiddenTypes, p.selectedId ?? null, hover.current, p.showRing ?? true, p.labels, logos.current, p.theme === "light"); } frame = requestAnimationFrame(draw); }; frame = requestAnimationFrame(draw);
    function wheel(event: WheelEvent) { event.preventDefault(); if (!surface) return; const rect = surface.getBoundingClientRect(); view.current = zoomAt(view.current, event.clientX - rect.left, event.clientY - rect.top, event.deltaY); }
    surface.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); surface.removeEventListener("wheel", wheel); };
  }, [props.nodes, props.links, props.rootId, props.height]);
  useEffect(() => { const current = sim.current, target = props.centerOn && current?.byId.get(props.centerOn.id); if (!current || !target) return; const k = Math.max(view.current.k, 1.8); view.current = { x: current.cx - target.x * k, y: current.cy - target.y * k, k }; }, [props.centerOn, props.nodes, props.links, props.rootId, props.height]);
  const gesture = useRef<{ x: number; y: number; startView: View; node: Particle | null; moved: boolean } | null>(null);
  function coordinates(event: React.PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top; return { x, y, wx: (x - view.current.x) / view.current.k, wy: (y - view.current.y) / view.current.k }; }
  function hit(x: number, y: number) { const current = sim.current; if (!current) return null; const hidden = new Set(latest.current.hiddenTypes); if (latest.current.showRing === false) current.nodes.filter(n => n.ring).forEach(n => hidden.add(n.type)); return hitTest(current, hidden, x, y, view.current.k); }
  function release(event: React.PointerEvent<HTMLCanvasElement>, cancel = false) { const active = gesture.current; if (!active) return; if (active.node && !active.node.ring && active.node.id !== latest.current.rootId) { delete active.node.fx; delete active.node.fy; } if (!cancel && !active.moved) { const p = coordinates(event); latest.current.onSelect(hit(p.wx, p.wy)); } gesture.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }
  return <div ref={container} className={`relative w-full overflow-hidden rounded-xl border ${props.theme === "light" ? "rn-canvas-light border-stone-200 bg-white" : "border-slate-800 bg-[#060a12]"}`} style={{ height: props.height }}>
    <canvas ref={canvas} className="block h-full w-full touch-none" aria-label="Interactive radial lead network. Drag nodes or empty space, scroll to zoom." role="img" onPointerDown={event => { if (event.button !== 0) return; const p = coordinates(event), node = hit(p.wx, p.wy); gesture.current = { x: p.x, y: p.y, startView: { ...view.current }, node, moved: false }; if (node && !node.ring) { node.fx = node.x; node.fy = node.y; } setTooltip(null); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { const p = coordinates(event), active = gesture.current; if (active) { if (Math.hypot(p.x - active.x, p.y - active.y) >= 3) active.moved = true; if (active.node) { if (!active.node.ring && active.node.id !== latest.current.rootId) { active.node.fx = p.wx; active.node.fy = p.wy; if (sim.current) sim.current.alpha = .25; } } else view.current = { ...active.startView, x: active.startView.x + p.x - active.x, y: active.startView.y + p.y - active.y }; return; } const node = hit(p.wx, p.wy); hover.current = node?.id ?? null; event.currentTarget.style.cursor = node ? "pointer" : "grab"; setTooltip(node ? { node, x: Math.max(8, Math.min(p.x + 14, event.currentTarget.clientWidth - 260)), y: Math.max(8, Math.min(p.y + 14, latest.current.height - 100)) } : null); }} onPointerUp={event => release(event)} onPointerCancel={event => release(event, true)} onPointerLeave={() => { hover.current = null; setTooltip(null); }} />
    {tooltip && <div className="pointer-events-none absolute z-10 max-w-64 rounded-lg border border-slate-600 bg-slate-950/95 p-3 shadow-xl backdrop-blur" style={{ left: tooltip.x, top: tooltip.y }}><div className="text-xs uppercase tracking-wider" style={{ color: tooltip.node.color }}>{tooltip.node.type}</div><div className="mt-1 text-sm font-semibold text-slate-100">{tooltip.node.label}</div><div className="mt-1 text-xs text-slate-400">{tooltip.node.sub}</div></div>}
    <div className="absolute bottom-4 left-4 flex gap-2"><button aria-label="Zoom out" className="rounded-md border border-slate-600 bg-slate-900/90 px-3 py-2 text-sm text-slate-200" onClick={() => { if (sim.current) view.current = zoomAt(view.current, sim.current.cx, sim.current.cy, 240); }}>−</button><button aria-label="Zoom in" className="rounded-md border border-slate-600 bg-slate-900/90 px-3 py-2 text-sm text-slate-200" onClick={() => { if (sim.current) view.current = zoomAt(view.current, sim.current.cx, sim.current.cy, -240); }}>+</button></div>
    <button className="absolute bottom-4 right-4 rounded-md border border-slate-600 bg-slate-900/90 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800" onClick={() => { view.current = { x: 0, y: 0, k: 1 }; latest.current.onSelect(null); }}>Reset view</button>
  </div>;
}
