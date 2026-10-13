"use client";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, CaretRight, Crosshair, MagnifyingGlass, Minus, Plus, ArrowsCounterClockwise, ArrowsOut, X } from "@phosphor-icons/react";
import { connectionPath, layers, layoutGraph, neighborhood, type Company, type Layer, type Point, type RelationshipGraph } from "@/lib/relationship-map/graph";
import { DEFAULT_CAMERA, fitCamera, graphSchema, metricsSchema, metricKeys, type PortfolioMetrics, edgePath, filterGraph, layerDesign, nodeRadius, placeLabels, shortLabel, zoomCamera, type Camera } from "@/lib/relationship-map/view";

import { ALL_SEGMENTS, revenueBands, segmentGraph, type SegmentFilters } from "@/lib/relationship-map/segments";


type Gesture = { kind: "pan"; start: Point; camera: Camera } | { kind: "node"; id: string; start: Point; point: Point };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
const date = (value: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
const Artwork = memo(function Artwork({ graph, points, selected, highlighted, scale, onSelect, onDrag }: { graph: RelationshipGraph; points: Record<string, Point>; selected: string | null; highlighted: Set<string> | null; scale: number; onSelect: (id: string) => void; onDrag: (id: string, event: ReactPointerEvent<SVGGElement>) => void }) {
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const labels = useMemo(() => {
    if (scale < 0.2) return {};
    const peopleCount = graph.nodes.filter((node) => node.kind === "person").length;
    const counters = new Map<string, number>();
    const labeled = graph.nodes.filter((node) => { const count = counters.get(node.kind) ?? 0; counters.set(node.kind, count + 1); return node.kind !== "company" && (selected === node.id || highlighted?.has(node.id) || (node.kind === "person" && peopleCount <= 12) || (node.kind !== "source" && count < 4)); });
    return placeLabels(labeled, points);
  }, [graph.nodes, points, selected, highlighted, scale]);
  return <>
    {graph.edges.map((edge) => { const from = points[edge.from], to = points[edge.to]; if (!from || !to) return null; const emphasized = selected === edge.from || selected === edge.to; return <path key={edge.id} d={edgePath(from, to)} className={`rm-edge ${emphasized ? "is-emphasized" : ""}`} stroke={emphasized ? layerDesign[byId.get(edge.to)!.kind].color : "#587184"} opacity={highlighted && !(highlighted.has(edge.from) && highlighted.has(edge.to)) ? 0.05 : emphasized ? 0.85 : 0.24} markerEnd={emphasized ? "url(#rm-arrow)" : undefined}><title>{`${byId.get(edge.from)?.label} → ${edge.label} → ${byId.get(edge.to)?.label}`}</title></path>; })}
    {graph.nodes.map((node) => { const point = points[node.id]; if (!point) return null; const design = layerDesign[node.kind], radius = node.kind === "company" ? Math.max(42, 5 / scale) : nodeRadius(node); const picked = selected === node.id; const dim = highlighted && !highlighted.has(node.id); const label = labels[node.id]; return <g key={node.id} transform={`translate(${point.x},${point.y})`} className={`rm-node is-${node.kind} ${picked ? "is-picked" : ""}`} opacity={dim ? 0.13 : 1} data-map-node={node.id} role="button" tabIndex={0} aria-label={`${design.label}: ${node.label}, ${node.status}`} aria-pressed={picked} onPointerDown={(event) => onDrag(node.id, event)} onClick={() => onSelect(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}>
      <title>{`${node.label} · ${node.status}`}</title><circle r={Math.max(radius + 12, 22)} fill="transparent" />{picked && <circle r={radius + 10} className="rm-selection-ring" stroke={design.color} />}{node.kind === "company" && <circle r={65} fill={design.color} opacity="0.055" />}
      <circle r={radius + 5} fill={design.color} opacity={picked || node.kind === "company" ? 0.15 : 0.04} />
      <circle r={radius} fill={node.kind === "company" ? "#172126" : design.color} stroke={node.kind === "company" || picked ? design.color : "#0c151c"} strokeWidth={node.kind === "company" ? 2 : 1.5} />
      {node.kind === "company" ? scale >= 0.05 ? <><text className="rm-initials" textAnchor="middle" y="6" fill={design.color}>{initials(node.label)}</text><text className="rm-company-label" textAnchor="middle" y={scale < 0.2 ? radius + 18 / scale : 84} style={{ fontSize: scale < 0.2 ? 11 / scale : undefined }}>{node.label.length > (scale < 0.2 ? 18 : 30) ? `${node.label.slice(0, scale < 0.2 ? 17 : 29)}…` : node.label}</text>{scale >= 0.2 && <text className="rm-company-domain" textAnchor="middle" y="104">{node.subtitle}</text>}</> : null : label && <><line x1="0" y1="0" x2={label.x > 0 ? label.x : label.x + label.width} y2={label.y + 17} stroke={design.color} strokeWidth="0.6" opacity="0.35" pointerEvents="none" /><rect x={label.x} y={label.y} width={label.width} height="34" rx="5" fill="#0c151c" stroke={picked ? design.color : "#233543"} opacity="0.97" /><text className="rm-node-label" x={label.x + 8} y={label.y + 24}>{shortLabel(node)}</text></>}
      {(node.status === "do not contact" || node.status === "bounced") && <circle cx={radius} cy={-radius} r="4" fill="#f1857e" stroke="#0c151c" strokeWidth="2" />}
    </g>; })}
  </>;
});
export function RelationshipMap({ initialCompanies, initialGraph, initialDomain = "", owner = "josh", showOwners = false }: { initialCompanies: Company[]; initialGraph: RelationshipGraph | null; initialDomain?: string; owner?: "josh" | "suuchi"; showOwners?: boolean }) {
  const [graph, setGraph] = useState(initialGraph);
  const fullGraph = useRef(initialGraph);
  const complete = useRef(false);
  const [loading, setLoading] = useState(false);
  const [metrics, setMetrics] = useState<PortfolioMetrics | null>(null);
  const [metricsError, setMetricsError] = useState("");
  const details = useRef(new Map<string, RelationshipGraph>());
  const loadController = useRef<AbortController | null>(null);
  const [domain, setDomain] = useState(initialDomain);
  const [segments, setSegments] = useState<SegmentFilters>(ALL_SEGMENTS);
  const scopedGraph = useMemo(() => {
    if (!graph) return null;
    const selectedCompanies = domain ? initialCompanies.filter((company) => company.domain === domain) : initialCompanies;
    return segmentGraph(graph, selectedCompanies, segments);
  }, [graph, initialCompanies, domain, segments]);
  const [initialCamera] = useState(() => initialGraph ? fitCamera(layoutGraph(initialDomain ? segmentGraph(initialGraph, initialCompanies.filter((company) => company.domain === initialDomain), ALL_SEGMENTS) : initialGraph)) : DEFAULT_CAMERA);
  const [companyQuery, setCompanyQuery] = useState(""); const [query, setQuery] = useState(""); const [picked, setPicked] = useState<string | null>(initialDomain ? initialGraph?.nodes.find((node) => node.kind === "company" && node.subtitle === initialDomain)?.id ?? null : null); const [enabled, setEnabled] = useState(new Set<Layer>(layers)); const [isolated, setIsolated] = useState(false); const [camera, setCamera] = useState<Camera>(initialCamera); const [manualPoints, setManualPoints] = useState<Record<string, Point>>({}); const [error, setError] = useState("");  const [mode, setMode] = useState<"map" | "list">("map");
  const svg = useRef<SVGSVGElement>(null); const cameraRef = useRef(initialCamera); const pointsRef = useRef<Record<string, Point>>({}); const gesture = useRef<Gesture | null>(null); const frame = useRef<number | null>(null);
  const basePositions = useMemo(() => scopedGraph ? layoutGraph(scopedGraph) : {}, [scopedGraph]);
  const positions = useMemo(() => ({ ...basePositions, ...manualPoints }), [basePositions, manualPoints]);
  useEffect(() => { pointsRef.current = positions; }, [positions]);
  const changeCamera = useCallback((value: Camera) => { cameraRef.current = value; setCamera(value); }, []);
  const choose = useCallback((id: string) => { setPicked(id); const kind = layers.find((layer) => id.startsWith(`${layer}:`)); if (kind) setEnabled((previous) => previous.has(kind) ? previous : new Set([...previous, kind])); }, []);
  const selected = scopedGraph?.nodes.find((node) => node.id === picked) ?? null;
  const rootId = selected?.companyId ? `company:${selected.companyId}` : scopedGraph?.nodes.find((node) => node.kind === "company")?.id ?? null;
  const adjacent = useMemo(() => scopedGraph && picked ? neighborhood(scopedGraph, picked) : null, [scopedGraph, picked]);
  const path = useMemo(() => scopedGraph && rootId && picked ? connectionPath(scopedGraph, rootId, picked) : [], [scopedGraph, rootId, picked]);
  const isolatedIds = useMemo(() => isolated && adjacent ? new Set([...adjacent.ids, ...path]) : null, [isolated, adjacent, path]);
  const visible = useMemo(() => scopedGraph ? filterGraph(scopedGraph, enabled, query, isolatedIds) : null, [scopedGraph, enabled, query, isolatedIds]);
  const highlighted = selected && (selected.kind !== "company" || !domain) ? adjacent?.ids ?? null : null;
  useEffect(() => {
    const element = svg.current; if (!element || mode !== "map") return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const rect = element.getBoundingClientRect(); const anchor = { x: (event.clientX - rect.left) * 1600 / rect.width, y: (event.clientY - rect.top) * 1160 / rect.height }; changeCamera(zoomCamera(cameraRef.current, Math.exp(-event.deltaY * 0.0015), anchor)); };
    element.addEventListener("wheel", wheel, { passive: false }); return () => element.removeEventListener("wheel", wheel);
  }, [changeCamera, mode, graph]);
  useEffect(() => () => { loadController.current?.abort(); if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const loadCompany = useCallback(async (value: string) => {
    loadController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    const company = initialCompanies.find((company) => company.domain === value);
    setDomain(value); setPicked(company ? `company:${company.id}` : null); setManualPoints({}); setQuery(""); setIsolated(false); setError("");
    window.history.replaceState(null, "", value ? `/network?owner=${owner}&company=${encodeURIComponent(value)}` : `/network?owner=${owner}`);
    if (!value) { setLoading(false); setGraph(fullGraph.current); if (fullGraph.current) changeCamera(fitCamera(layoutGraph(segmentGraph(fullGraph.current, initialCompanies, segments)))); return; }
    if (complete.current && fullGraph.current) { setGraph(fullGraph.current); changeCamera(fitCamera(layoutGraph(segmentGraph(fullGraph.current, initialCompanies.filter((company) => company.domain === value), segments)))); setLoading(false); return; }
    setLoading(true);
    try {
      let next = details.current.get(value);
      if (!next) {
        const response = await fetch(`/api/network?owner=${owner}&domain=${encodeURIComponent(value)}`, { signal: controller.signal, cache: "no-store" });
        const data: unknown = await response.json();
        if (!response.ok || typeof data !== "object" || !data || !("graph" in data)) throw new Error(typeof data === "object" && data && "error" in data ? String(data.error) : "Company relationships could not be loaded. Try again.");
        next = graphSchema.parse(data.graph); if (controller.signal.aborted) return; details.current.set(value, next);
      }
      const roots = initialGraph?.nodes.filter((node) => node.kind === "company") ?? [];
      const merged = { ...next, companyId: null, nodes: [...roots, ...next.nodes.filter((node) => node.kind !== "company")] };
      setGraph(complete.current && fullGraph.current ? fullGraph.current : merged);
      changeCamera(fitCamera(layoutGraph(segmentGraph(merged, initialCompanies.filter((company) => company.domain === value), segments))));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Company relationships could not be loaded."); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }, [initialGraph, initialCompanies, segments, changeCamera, owner]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/network?scope=all&owner=${owner}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Target-list relationships could not be loaded. Refresh to retry.");
      const data: unknown = await response.json();
      if (typeof data !== "object" || !data || !("graph" in data)) throw new Error("Invalid target-list response.");
      const next = graphSchema.parse(data.graph);
      if (!controller.signal.aborted) {
        const companies = Object.fromEntries(initialCompanies.map((company) => [company.id, Object.fromEntries(metricKeys.map((key) => [key, 0]))]));
        for (const node of next.nodes) if (node.companyId && companies[node.companyId] && metricKeys.some((key) => key === node.kind)) companies[node.companyId][node.kind]++;
        fullGraph.current = next; complete.current = true; setGraph(next);
        setMetrics(metricsSchema.parse({ companies, warnings: next.warnings }));
      }
    }).catch((error: unknown) => { if (!controller.signal.aborted) setMetricsError(error instanceof Error ? error.message : "Portfolio totals could not be loaded."); });
    return () => controller.abort();
  }, [owner, initialCompanies]);
  const initialLoad = useRef(false);
  useEffect(() => { if (!initialDomain || initialLoad.current) return; initialLoad.current = true; void Promise.resolve().then(() => loadCompany(initialDomain)); }, [initialDomain, loadCompany]);
  function updateSegments(next: SegmentFilters) {
    loadController.current?.abort(); setLoading(false);
    setDomain(""); setPicked(null); setIsolated(false); setManualPoints({}); setSegments(next);
    if (fullGraph.current) changeCamera(fitCamera(layoutGraph(segmentGraph(fullGraph.current, initialCompanies, next))));
    window.history.replaceState(null, "", `/network?owner=${owner}`);
  }
  const companies = initialCompanies.filter((company) => `${company.name} ${company.domain}`.toLowerCase().includes(companyQuery.toLowerCase()));
  function segmentControl(field: keyof SegmentFilters, label: string, values: string[]) {
    return <label>{label}<select aria-label={label} value={segments[field]} onChange={(event) => { updateSegments({ ...segments, [field]: event.target.value }); }}><option value="">All {label.toLowerCase()}</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
  }
  const dragNode = useCallback((id: string, event: ReactPointerEvent<SVGGElement>) => { event.stopPropagation(); if (event.button !== 0) return; const point = pointsRef.current[id]; if (!point) return; choose(id); gesture.current = { kind: "node", id, point, start: { x: event.clientX, y: event.clientY } }; svg.current?.setPointerCapture(event.pointerId); }, [choose]);
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current; const element = svg.current; if (!active || !element) return;
    const rect = element.getBoundingClientRect(); const dx = (event.clientX - active.start.x) * 1600 / rect.width; const dy = (event.clientY - active.start.y) * 1160 / rect.height;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { if (active.kind === "pan") changeCamera({ ...active.camera, x: active.camera.x + dx, y: active.camera.y + dy }); else { const scale = cameraRef.current.scale; setManualPoints((points) => ({ ...points, [active.id]: { x: active.point.x + dx / scale, y: active.point.y + dy / scale } })); } frame.current = null; });
  }
  function stop() { gesture.current = null; }
  function reset() { setManualPoints({}); changeCamera(fitCamera(basePositions)); setIsolated(false); setQuery(""); setEnabled(new Set(layers)); setPicked(rootId); }
  function focus() { if (!picked || !positions[picked]) return; const point = positions[picked]; changeCamera({ x: 800 - point.x * 1.15, y: 580 - point.y * 1.15, scale: 1.15 }); }
  const counts = useMemo(() => {
    const counts = Object.fromEntries(layers.map((kind) => [kind, scopedGraph?.nodes.filter((node) => node.kind === kind).length ?? 0])) as Record<Layer, number>;
    if (metrics) {
      const ids = scopedGraph?.nodes.filter((node) => node.kind === "company").map((node) => node.companyId!) ?? [];
      for (const kind of metricKeys) counts[kind] = ids.reduce((sum, id) => sum + (metrics.companies[id]?.[kind] ?? 0), 0);
    }
    return counts;
  }, [scopedGraph, metrics]);
  const summaryMetrics = [{ label: "Contacts", value: counts.person, note: "People on file" }, { label: "Reach-outs", value: counts.outreach, note: "Recorded sends" }, { label: "Replies", value: counts.reply, note: "Recorded responses" }, { label: "Research inputs", value: counts.signal + counts.job + counts.post + counts.discovery, note: "Signals with provenance" }, { label: "Delivery issues", value: counts.bounce, note: "Bounces on file" }];
  return <div className="rm-workspace">
    {showOwners && <nav className="rm-segments" aria-label="List owner"><Link href="/network?owner=josh" aria-current={owner === "josh" ? "page" : undefined}>Josh’s lists</Link><Link href="/network?owner=suuchi" aria-current={owner === "suuchi" ? "page" : undefined}>Suuchi’s lists</Link></nav>}
    <section className="rm-summary" aria-label="Portfolio relationship totals">{summaryMetrics.map((metric) => <div key={metric.label}><strong>{!metrics ? "…" : metric.value}</strong><span>{metric.label}</span><small>{metric.note}</small></div>)}</section>
    <div className="rm-toolbar"><div className="rm-company-picker"><label htmlFor="rm-company-query">Company</label><input id="rm-company-query" value={companyQuery} placeholder="Search companies…" onChange={(event) => { setCompanyQuery(event.target.value);  }} /><select aria-label="Choose company" value={domain} onChange={(event) => void loadCompany(event.target.value)}><option value="">All {initialCompanies.length} target companies</option>{domain && !companies.some((company) => company.domain === domain) && <option value={domain}>{graph?.nodes.find((node) => node.kind === "company")?.label ?? domain}</option>}{companies.map((company) => <option key={company.id} value={company.domain}>{company.name}</option>)}</select></div><label className="rm-find"><MagnifyingGlass size={17} /><input aria-label="Find a node" placeholder="Find a contact, message or signal…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="Clear node search" onClick={() => setQuery("")}><X size={14} /></button>}</label><div className="rm-mode"><button aria-pressed={mode === "map"} onClick={() => setMode("map")}>Map</button><button aria-pressed={mode === "list"} onClick={() => setMode("list")}>List</button></div></div>
    <div className="rm-segments">
      {segmentControl("batch", "Lists", [...new Set(initialCompanies.map((company) => company.outreachList || "Not recorded"))].sort())}
      {segmentControl("industry", "Industries", [...new Set(initialCompanies.map((company) => company.vertical || "Unknown"))].sort())}
      <label>Revenue<select aria-label="Revenue" value={segments.revenue} onChange={(event) => { updateSegments({ ...segments, revenue: event.target.value }); }}><option value="">All revenue bands</option>{revenueBands.map((band) => <option key={band.value} value={band.value}>{band.label}</option>)}</select></label>
      {segmentControl("employees", "Employee size", [...new Set(initialCompanies.map((company) => company.employee_range || "Unknown"))].sort())}
      {segmentControl("status", "Statuses", [...new Set(initialCompanies.map((company) => company.status))].sort())}
      {segmentControl("owner", "Owners", [...new Set(initialCompanies.map((company) => company.outreach_owner || "Unassigned"))].sort())}
      {segmentControl("stage", "Outreach stages", [...new Set(initialCompanies.map((company) => company.outreach_stage || "Not recorded"))].sort())}
      <button onClick={() => { updateSegments(ALL_SEGMENTS); setEnabled(new Set(layers)); setQuery(""); setCompanyQuery(""); }}>Show everything</button>
    </div>
    <p className="rm-coverage">{counts.company} of {initialCompanies.length} companies in this view · All companies on these active outreach lists are loaded. {metrics ? "Their complete stored relationships are loaded" : "Loading their contacts, outreach and research relationships…"}. Revenue is recorded research, not a current financial estimate. Unknown values remain selectable.</p>
    {metricsError && <p role="alert" className="rm-warning">{metricsError}</p>}{metrics?.warnings.map((warning) => <p key={warning} className="rm-warning">{warning}</p>)}
    {error && <div role="alert" className="rm-warning">{error}</div>}{graph?.warnings.length ? <details className="rm-coverage"><summary>Some layers are incomplete · {graph.warnings.length} coverage notices</summary>{graph.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details> : null}
    <div className="rm-layer-chips" aria-label="Filter relationship layers">{layers.map((kind) => <button key={kind} aria-pressed={enabled.has(kind)} disabled={kind === "company"} className={enabled.has(kind) ? "is-on" : ""} onClick={() => setEnabled((previous) => { const next = new Set(previous); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; })}><i style={{ background: layerDesign[kind].color }} /><span>{layerDesign[kind].label}</span><b>{counts[kind]}</b></button>)}</div>
    <div className="rm-main"><section className={`rm-canvas `} aria-label="Interactive company relationship map">
      <div className="rm-canvas-heading"><span><i /> COMPANY CONNECTIONS</span><small>{visible?.nodes.length ?? 0} nodes · {visible?.edges.length ?? 0} relationships</small></div>
      {mode === "map" ? <><svg ref={svg} viewBox="0 0 1600 1160" role="group" aria-label="Relationship graph. Tab through nodes, then press Enter to inspect. Drag to pan; scroll to zoom." onPointerDown={(event) => { if (event.button !== 0) return; gesture.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, camera: cameraRef.current }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
        <defs><pattern id="rm-grid" width="60" height="60" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#294050" opacity="0.4" /></pattern><radialGradient id="rm-glow"><stop offset="0" stopColor="#274651" stopOpacity="0.17" /><stop offset="1" stopColor="#0c151c" stopOpacity="0" /></radialGradient><marker id="rm-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9" fill="#acbbc6" /></marker></defs>
        <rect width="1600" height="1160" fill="url(#rm-grid)" /><ellipse cx="800" cy="580" rx="640" ry="530" fill="url(#rm-glow)" />
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>{counts.company === 1 && <g className="rm-orbits" aria-hidden="true" transform={`translate(${rootId ? positions[rootId]?.x ?? 0 : 0},${rootId ? positions[rootId]?.y ?? 0 : 0})`}><circle r="260" /><circle r="440" /><circle r="625" /><text x="-260" y="-235">PEOPLE</text><text x="255" y="-260">OUTREACH</text><text x="-415" y="320">RESEARCH INPUTS</text><text x="330" y="355">RESPONSES</text></g>}{visible && <Artwork graph={visible} points={positions} selected={picked} highlighted={highlighted} scale={camera.scale} onSelect={choose} onDrag={dragNode} />}</g>
      </svg><div className="rm-map-controls"><button aria-label="Zoom out" onClick={() => changeCamera(zoomCamera(cameraRef.current, 0.8, { x: 800, y: 580 }))}><Minus size={17} /></button><span>{Math.round(camera.scale * 100)}%</span><button aria-label="Zoom in" onClick={() => changeCamera(zoomCamera(cameraRef.current, 1.25, { x: 800, y: 580 }))}><Plus size={17} /></button><button aria-label="Center selected node" onClick={focus}><Crosshair size={17} /></button><button aria-label="Open map fullscreen" onClick={() => { const container = svg.current?.closest(".rm-canvas"); if (container instanceof HTMLElement) void container.requestFullscreen().catch(() => setError("Fullscreen is unavailable in this browser.")); }}><ArrowsOut size={17} /></button><button aria-label="Reset graph layout and filters" onClick={reset}><ArrowsCounterClockwise size={17} /></button></div><p className="rm-map-hint">Click a node to trace its connections. Drag nodes to arrange. Drag the background to pan.</p></> : <div className="rm-list">{visible?.nodes.map((node) => <button key={node.id} className={node.id === picked ? "is-selected" : ""} onClick={() => choose(node.id)}><i style={{ background: layerDesign[node.kind].color }} /><span><strong>{node.label}</strong><small>{layerDesign[node.kind].label} · {node.subtitle}</small></span><em>{node.status}</em><CaretRight size={16} /></button>)}</div>}
      {loading && <div className="rm-loading" role="status">Loading this company’s complete relationships…</div>}{!graph && <div className="rm-loading">No companies are available to explore.</div>}{visible && visible.nodes.length <= 1 && <p className="rm-empty">No additional records match the current layers and search.</p>}
    </section><aside className="rm-inspector" aria-label="Selected relationship details">
      {selected ? <><div className="rm-inspector-kind"><i style={{ background: layerDesign[selected.kind].color }} />{layerDesign[selected.kind].label}<span>{selected.status}</span></div><h2>{selected.label}</h2><p className="rm-subtitle">{selected.subtitle}</p><p className="rm-detail">{selected.detail}</p>{selected.at && <p className="rm-date">Recorded date · {date(selected.at)}</p>}<dl>{selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl><div className="rm-inspector-actions">{selected.kind === "company" && <button disabled={loading} onClick={() => void loadCompany(selected.subtitle)}>Expand relationships <ArrowUpRight size={15} /></button>}{selected.href && <Link href={selected.href}>Open record <ArrowUpRight size={15} /></Link>}{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Original source <ArrowUpRight size={15} /></a>}<button onClick={focus}>Center node <Crosshair size={15} /></button></div><label className="rm-isolate"><input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} /> Show this connection path only</label>
      {path.length > 1 && <div className="rm-path"><h3>Path from company</h3>{path.map((id, index) => { const node = graph!.nodes.find((node) => node.id === id)!; return <button key={id} onClick={() => choose(id)}><small>{String(index + 1).padStart(2, "0")}</small><i style={{ background: layerDesign[node.kind].color }} /><span>{shortLabel(node, 40)}</span></button>; })}</div>}
      <div className="rm-connections"><h3>Direct connections <span>{adjacent?.edges.length ?? 0}</span></h3>{adjacent?.edges.map((edge) => { const id = edge.from === selected.id ? edge.to : edge.from; const node = graph!.nodes.find((node) => node.id === id)!; return <button key={edge.id} onClick={() => choose(id)}><i style={{ background: layerDesign[node.kind].color }} /><span><strong>{shortLabel(node, 40)}</strong><small>{edge.from === selected.id ? edge.label : `Connected by: ${edge.label}`}</small></span><CaretRight size={14} /></button>; })}{!adjacent?.edges.length && <p>No linked records are loaded for this node.</p>}</div></> : <><h2>Explore the portfolio</h2><p>Choose a node to see its source, recorded state and direct relationships.</p></>}
      <details className="rm-legend"><summary>About the layers</summary>{layers.map((kind) => <p key={kind}><i style={{ background: layerDesign[kind].color }} /><span><b>{layerDesign[kind].label}</b>{layerDesign[kind].description}</span></p>)}</details><p className="rm-integrity">Every line comes from a recorded relationship. Missing data is not filled with inferred connections.</p>
    </aside></div>
  </div>;
}
