"use client";
import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowUpRight, CaretRight, Crosshair, MagnifyingGlass, Minus, Plus, ArrowsCounterClockwise, ArrowsOut, X } from "@phosphor-icons/react";
import { connectionPath, layers, layoutGraph, neighborhood, type Company, type Layer, type Point, type RelationshipGraph } from "@/lib/relationship-map/graph";
import { DEFAULT_CAMERA, fitCamera, graphSchema, metricsSchema, metricKeys, type PortfolioMetrics, edgePath, filterGraph, layerDesign, nodeRadius, placeLabels, shortLabel, zoomCamera, type Camera } from "@/lib/relationship-map/view";

import { ALL_SEGMENTS, matchesSegment, revenueBands, segmentGraph, type SegmentFilters } from "@/lib/relationship-map/segments";


import { EvidencePanel, JourneyArtwork } from "@/components/RelationshipViews";
import { dateLabel, fact, journeyLanes, journeyLayout, recordedDate } from "@/lib/relationship-map/presentation";

import { canvasPoint, centeredCamera, minimapGeometry, orderedCompanies } from "@/lib/relationship-map/navigation";

const mapLayout = (graph: RelationshipGraph) => graph.nodes.filter((node) => node.kind === "company").length === 1 ? journeyLayout(graph) : layoutGraph(graph);

type Gesture = { kind: "pan"; start: Point; camera: Camera; last?: Point } | { kind: "node"; id: string; start: Point; point: Point; last?: Point };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
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
  const [arrange, setArrange] = useState(false);
  const [searchIndex, setSearchIndex] = useState(0);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
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
  const [initialCamera] = useState(() => initialGraph ? fitCamera(mapLayout(initialDomain ? segmentGraph(initialGraph, initialCompanies.filter((company) => company.domain === initialDomain), ALL_SEGMENTS) : initialGraph)) : DEFAULT_CAMERA);
  const [companyQuery, setCompanyQuery] = useState(""); const [query, setQuery] = useState(""); const [picked, setPicked] = useState<string | null>(initialDomain ? initialGraph?.nodes.find((node) => node.kind === "company" && node.subtitle === initialDomain)?.id ?? null : null); const [enabled, setEnabled] = useState(new Set<Layer>(layers)); const [isolated, setIsolated] = useState(false); const [camera, setCamera] = useState<Camera>(initialCamera); const [manualPoints, setManualPoints] = useState<Record<string, Point>>({}); const [error, setError] = useState("");  const [copied, setCopied] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null); const cameraRef = useRef(initialCamera); const pointsRef = useRef<Record<string, Point>>({}); const gesture = useRef<Gesture | null>(null); const frame = useRef<number | null>(null);
  const basePositions = useMemo(() => scopedGraph ? mapLayout(scopedGraph) : {}, [scopedGraph]);
  const positions = useMemo(() => ({ ...basePositions, ...manualPoints }), [basePositions, manualPoints]);
  useEffect(() => { pointsRef.current = positions; }, [positions]);
  const changeCamera = useCallback((value: Camera) => { cameraRef.current = value; setCamera(value); }, []);
  const choose = useCallback((id: string) => { setHover(null); setPicked(id); const kind = layers.find((layer) => id.startsWith(`${layer}:`)); if (kind) setEnabled((previous) => previous.has(kind) ? previous : new Set([...previous, kind])); }, []);
  const selectFromChart = useCallback((id: string) => { if (!suppressClick.current) choose(id); }, [choose]);
  const selected = scopedGraph?.nodes.find((node) => node.id === picked) ?? null;
  const rootId = selected?.companyId && scopedGraph?.nodes.some((node) => node.id === `company:${selected.companyId}`) ? `company:${selected.companyId}` : scopedGraph?.nodes.find((node) => node.kind === "company")?.id ?? null;
  const adjacent = useMemo(() => scopedGraph && picked ? neighborhood(scopedGraph, picked) : null, [scopedGraph, picked]);
  const path = useMemo(() => scopedGraph && rootId && picked ? connectionPath(scopedGraph, rootId, picked) : [], [scopedGraph, rootId, picked]);
  const isolatedIds = useMemo(() => isolated && adjacent ? new Set([...adjacent.ids, ...path]) : null, [isolated, adjacent, path]);
  const visible = useMemo(() => scopedGraph ? filterGraph(scopedGraph, enabled, query, isolatedIds) : null, [scopedGraph, enabled, query, isolatedIds]);

  const visiblePositions = useMemo(() => Object.fromEntries((visible?.nodes ?? []).filter((node) => positions[node.id]).map((node) => [node.id, positions[node.id]])), [visible, positions]);
  const highlighted = selected && (selected.kind !== "company" || !domain) ? adjacent?.ids ?? null : null;
  useEffect(() => {
    const element = svg.current; if (!element) return;
    const wheel = (event: WheelEvent) => { event.preventDefault(); const rect = element.getBoundingClientRect(); const anchor = canvasPoint({ x: event.clientX, y: event.clientY }, rect); changeCamera(zoomCamera(cameraRef.current, Math.exp(-event.deltaY * 0.0015), anchor)); };
    element.addEventListener("wheel", wheel, { passive: false }); return () => element.removeEventListener("wheel", wheel);
  }, [changeCamera, graph]);
  useEffect(() => () => { loadController.current?.abort(); if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  const loadCompany = useCallback(async (value: string) => {
    loadController.current?.abort();
    const controller = new AbortController(); loadController.current = controller;
    const company = initialCompanies.find((company) => company.domain === value);
    setHover(null); setDomain(value); setPicked(company ? `company:${company.id}` : null); setManualPoints({}); setQuery(""); setIsolated(false); setError("");
    window.history.replaceState(null, "", value ? `/network?owner=${owner}&company=${encodeURIComponent(value)}` : `/network?owner=${owner}`);
    if (!value) { setLoading(false); setGraph(fullGraph.current); if (fullGraph.current) changeCamera(fitCamera(mapLayout(segmentGraph(fullGraph.current, initialCompanies, segments)))); return; }
    if (complete.current && fullGraph.current) { setGraph(fullGraph.current); changeCamera(fitCamera(mapLayout(segmentGraph(fullGraph.current, initialCompanies.filter((company) => company.domain === value), segments)))); setLoading(false); return; }
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
      changeCamera(fitCamera(mapLayout(segmentGraph(merged, initialCompanies.filter((company) => company.domain === value), segments))));
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
    if (fullGraph.current) changeCamera(fitCamera(mapLayout(segmentGraph(fullGraph.current, initialCompanies, next))));
    window.history.replaceState(null, "", `/network?owner=${owner}`);
  }
  const companies = initialCompanies.filter((company) => `${company.name} ${company.domain}`.toLowerCase().includes(companyQuery.toLowerCase()));
  function segmentControl(field: keyof SegmentFilters, label: string, values: string[]) {
    return <label>{label}<select aria-label={label} value={segments[field]} onChange={(event) => { updateSegments({ ...segments, [field]: event.target.value }); }}><option value="">All {label.toLowerCase()}</option>{values.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>;
  }
  const dragNode = useCallback((id: string, event: ReactPointerEvent<SVGGElement>) => {
    if (!arrange || event.button !== 0) return;
    event.stopPropagation(); suppressClick.current = false;
    const point = pointsRef.current[id]; if (!point) return;
    choose(id); gesture.current = { kind: "node", id, point, start: { x: event.clientX, y: event.clientY } }; svg.current?.setPointerCapture(event.pointerId);
  }, [choose, arrange]);
  function move(event: ReactPointerEvent<SVGSVGElement>) {
    const active = gesture.current; const element = svg.current; if (!element) return;
    if (!active) {
      const target = event.target instanceof Element ? event.target.closest("[data-map-node]") : null;
      const id = target?.getAttribute("data-map-node"); const rect = element.parentElement!.getBoundingClientRect();
      setHover(id && id !== picked ? { id, x: Math.min(Math.max(12, event.clientX - rect.left + 18), Math.max(12, rect.width - 290)), y: Math.min(Math.max(60, event.clientY - rect.top + 18), Math.max(60, rect.height - 190)) } : null); return;
    }
    setHover(null); active.last = { x: event.clientX, y: event.clientY };
    if (Math.hypot(event.clientX - active.start.x, event.clientY - active.start.y) > 4) { suppressClick.current = true; element.setPointerCapture(event.pointerId); }
    if (active.kind === "pan" && !suppressClick.current) return;
    const rect = element.getBoundingClientRect(); const start = canvasPoint(active.start, rect), end = canvasPoint({ x: event.clientX, y: event.clientY }, rect); const dx = end.x - start.x, dy = end.y - start.y;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { if (active.kind === "pan") changeCamera({ ...active.camera, x: active.camera.x + dx, y: active.camera.y + dy }); else { const scale = cameraRef.current.scale; setManualPoints((points) => ({ ...points, [active.id]: { x: active.point.x + dx / scale, y: active.point.y + dy / scale } })); } frame.current = null; });
  }
  function stop() {
    const active = gesture.current; gesture.current = null;
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (!active?.last || !svg.current || (active.kind === "pan" && !suppressClick.current)) return;
    const rect = svg.current.getBoundingClientRect(), start = canvasPoint(active.start, rect), end = canvasPoint(active.last, rect);
    if (active.kind === "pan") changeCamera({ ...active.camera, x: active.camera.x + end.x - start.x, y: active.camera.y + end.y - start.y });
    else setManualPoints((points) => ({ ...points, [active.id]: { x: active.point.x + (end.x - start.x) / cameraRef.current.scale, y: active.point.y + (end.y - start.y) / cameraRef.current.scale } }));
  }
  function reset() { setManualPoints({}); changeCamera(fitCamera(basePositions)); setIsolated(false); setQuery(""); setEnabled(new Set(layers)); setPicked(rootId); }
  function focus() { if (picked && positions[picked]) changeCamera(centeredCamera(positions[picked], 1.05)); }
  const searchHits = query.trim() ? scopedGraph?.nodes.filter((node) => `${node.label} ${node.subtitle} ${node.facts.map((item) => item.value).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8) ?? [] : [];
  function jumpTo(id: string) {
    const node = graph?.nodes.find((node) => node.id === id); if (!node) return;
    suppressClick.current = false; setQuery("");
    if (node.kind === "company") { void loadCompany(node.subtitle); return; }
    choose(id); if (positions[id]) changeCamera(centeredCamera(positions[id], 1.05));
  }
  const hovered = hover ? graph?.nodes.find((node) => node.id === hover.id) : null;
  const miniature = useMemo(() => minimapGeometry(positions), [positions]);
  const navigationCompanies = orderedCompanies(initialCompanies.filter((company) => matchesSegment(company, segments)));
  const currentIndex = navigationCompanies.findIndex((company) => company.domain === domain);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setQuery(""); searchInput.current?.blur(); setPicked(null); setIsolated(false); setHover(null); return; }
      if (event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))) return;
      if (event.key === "/") { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === "Home") { event.preventDefault(); changeCamera(fitCamera(visiblePositions)); }
    };
    window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard);
  }, [visiblePositions, changeCamera]);
  const counts = useMemo(() => {
    const counts = Object.fromEntries(layers.map((kind) => [kind, scopedGraph?.nodes.filter((node) => node.kind === kind).length ?? 0])) as Record<Layer, number>;
    if (metrics) {
      const ids = scopedGraph?.nodes.filter((node) => node.kind === "company").map((node) => node.companyId!) ?? [];
      for (const kind of metricKeys) counts[kind] = ids.reduce((sum, id) => sum + (metrics.companies[id]?.[kind] ?? 0), 0);
    }
    return counts;
  }, [scopedGraph, metrics]);

  return <div className="rm-workspace">
    {showOwners && <nav className="rm-segments" aria-label="List owner"><Link href="/network?owner=josh" aria-current={owner === "josh" ? "page" : undefined}>Josh’s lists</Link><Link href="/network?owner=suuchi" aria-current={owner === "suuchi" ? "page" : undefined}>Suuchi’s lists</Link></nav>}

    <div className="rm-toolbar"><div className="rm-company-picker"><label htmlFor="rm-company-query">Company</label><input id="rm-company-query" value={companyQuery} placeholder="Search companies…" onChange={(event) => { setCompanyQuery(event.target.value);  }} /><select aria-label="Choose company" value={domain} onChange={(event) => void loadCompany(event.target.value)}><option value="">All {initialCompanies.length} target companies</option>{domain && !companies.some((company) => company.domain === domain) && <option value={domain}>{graph?.nodes.find((node) => node.kind === "company")?.label ?? domain}</option>}{companies.map((company) => <option key={company.id} value={company.domain}>{company.name}</option>)}</select></div><label className="rm-find"><MagnifyingGlass size={17} /><input ref={searchInput} aria-label="Find a node" placeholder="Find a contact, message or signal…" value={query} onKeyDown={(event) => { if ((event.key === "ArrowDown" || event.key === "ArrowUp") && searchHits.length) { event.preventDefault(); setSearchIndex((index) => (index + (event.key === "ArrowDown" ? 1 : searchHits.length - 1)) % searchHits.length); } if (event.key === "Enter" && searchHits[Math.min(searchIndex, searchHits.length - 1)]) { event.preventDefault(); jumpTo(searchHits[Math.min(searchIndex, searchHits.length - 1)].id); } }} onChange={(event) => { setSearchIndex(0); setQuery(event.target.value); }} />{query && <button aria-label="Clear node search" onClick={() => setQuery("")}><X size={14} /></button>}{query.trim() && <div className="rm-search-results" role="region" aria-label="Matching graph records">{searchHits.map((node, index) => <button key={node.id} className={index === Math.min(searchIndex, searchHits.length - 1) ? "is-active" : ""} onMouseEnter={() => setSearchIndex(index)} onClick={() => jumpTo(node.id)}><i style={{ background: layerDesign[node.kind].color }} /><span><strong>{shortLabel(node, 36)}</strong><small>{layerDesign[node.kind].label} · {node.subtitle}</small></span><span>↗</span></button>)}{!searchHits.length && <p>No matching records in this view.</p>}{searchHits.length > 0 && <small className="rm-search-hint">↑ ↓ choose · Enter open · Type more to refine</small>}</div>}</label></div>
    <details className="rm-filter-panel"><summary>Filter companies <span>{Object.values(segments).filter(Boolean).length ? `${Object.values(segments).filter(Boolean).length} active` : "Lists, industry, revenue, company size and outreach state"}</span></summary><div className="rm-segments">
      {segmentControl("batch", "Lists", [...new Set(initialCompanies.map((company) => company.outreachList || "Not recorded"))].sort())}
      {segmentControl("industry", "Industries", [...new Set(initialCompanies.map((company) => company.vertical || "Unknown"))].sort())}
      <label>Revenue<select aria-label="Revenue" value={segments.revenue} onChange={(event) => { updateSegments({ ...segments, revenue: event.target.value }); }}><option value="">All revenue bands</option>{revenueBands.map((band) => <option key={band.value} value={band.value}>{band.label}</option>)}</select></label>
      {segmentControl("employees", "Employee size", [...new Set(initialCompanies.map((company) => company.employee_range || "Unknown"))].sort())}
      {segmentControl("status", "Statuses", [...new Set(initialCompanies.map((company) => company.status))].sort())}
      {segmentControl("owner", "Owners", [...new Set(initialCompanies.map((company) => company.outreach_owner || "Unassigned"))].sort())}
      {segmentControl("stage", "Outreach stages", [...new Set(initialCompanies.map((company) => company.outreach_stage || "Not recorded"))].sort())}
      <button onClick={() => { updateSegments(ALL_SEGMENTS); setEnabled(new Set(layers)); setQuery(""); setCompanyQuery(""); }}>Show everything</button>
    </div><small>Revenue figures retain their stored status, year and source. Unknown values remain selectable.</small></details>
    <p className="rm-data-status"><span className={metrics ? "is-ready" : "is-pending"} />{counts.company} of {initialCompanies.length} target companies · {metrics ? "Stored relationships loaded" : "Loading relationship details…"}<small>{graph ? `Snapshot ${recordedDate(graph.loadedAt, true)}` : ""}</small></p>
    {metricsError && <p role="alert" className="rm-warning">{metricsError}</p>}{metrics?.warnings.map((warning) => <p key={warning} className="rm-warning">{warning}</p>)}
    {error && <div role="alert" className="rm-warning">{error}</div>}{graph?.warnings.length ? <details className="rm-coverage"><summary>Some layers are incomplete · {graph.warnings.length} coverage notices</summary>{graph.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details> : null}
    <div className="rm-layer-chips" aria-label="Filter relationship layers">{layers.map((kind) => <button key={kind} aria-pressed={enabled.has(kind)} disabled={kind === "company"} className={enabled.has(kind) ? "is-on" : ""} onClick={() => setEnabled((previous) => { const next = new Set(previous); if (next.has(kind)) next.delete(kind); else next.add(kind); return next; })}><i style={{ background: layerDesign[kind].color }} /><span>{layerDesign[kind].label}</span><b>{kind === "company" || metrics ? counts[kind] : "…"}</b></button>)}</div>
    <div className="rm-navigation-strip"><button onClick={() => void loadCompany("")} aria-current={!domain ? "page" : undefined}>All targets</button>{domain && <><span>›</span><strong>{initialCompanies.find((company) => company.domain === domain)?.name ?? domain}</strong><div className="rm-company-stepper"><button disabled={currentIndex <= 0} onClick={() => void loadCompany(navigationCompanies[currentIndex - 1].domain)}>← Previous</button><small>{Math.max(0, currentIndex + 1)} / {navigationCompanies.length}</small><button disabled={currentIndex < 0 || currentIndex >= navigationCompanies.length - 1} onClick={() => void loadCompany(navigationCompanies[currentIndex + 1].domain)}>Next →</button></div></>}{selected && selected.kind !== "company" && <small className="rm-current-record">› {shortLabel(selected, 28)}</small>}<span className="rm-navigation-tip">Double-click a company to explore · / search · Esc close</span></div>
    <div className="rm-main is-chart-only"><section className={`rm-canvas is-map ${arrange ? "is-arranging" : ""}`} aria-label="Interactive company relationship map">
      <div className="rm-canvas-heading"><span><i />{domain ? "COMPANY RELATIONSHIP FLOW" : "ALL COMPANY CONNECTIONS"}</span><small>{visible?.nodes.length ?? 0} records · {visible?.edges.length ?? 0} links</small></div>

      <svg ref={svg} viewBox="0 0 1600 1160" role="group" aria-label="Relationship graph. Tab through nodes, then press Enter to inspect. Drag to pan; scroll to zoom." onDoubleClick={(event) => { const target = event.target instanceof Element ? event.target.closest("[data-map-node]") : null; const node = graph?.nodes.find((node) => node.id === target?.getAttribute("data-map-node")); if (node?.kind === "company") void loadCompany(node.subtitle); }} onPointerLeave={() => setHover(null)} onPointerDown={(event) => { if (event.button !== 0) return; suppressClick.current = false; gesture.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, camera: cameraRef.current }; if (!(event.target instanceof Element && event.target.closest("[data-map-node]"))) event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
        <defs><pattern id="rm-grid" width="60" height="60" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#294050" opacity="0.4" /></pattern><radialGradient id="rm-glow"><stop offset="0" stopColor="#274651" stopOpacity="0.17" /><stop offset="1" stopColor="#0c151c" stopOpacity="0" /></radialGradient><marker id="rm-arrow" viewBox="0 0 10 10" refX="16" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9" fill="#acbbc6" /></marker></defs>
        <rect width="1600" height="1160" fill="url(#rm-grid)" /><ellipse cx="800" cy="580" rx="640" ry="530" fill="url(#rm-glow)" />
        <g transform={`translate(${camera.x},${camera.y}) scale(${camera.scale})`}>{counts.company === 1 && <g className="rm-journey-lanes" aria-hidden="true">{journeyLanes.map((lane) => <g key={lane.label} transform={`translate(${lane.x},${lane.y})`}><text textAnchor="middle">{lane.label}</text><line x1="-150" x2="150" y1="20" y2="20" /></g>)}</g>}{visible && (counts.company === 1 ? <JourneyArtwork graph={visible} points={positions} selected={picked} highlighted={highlighted} onSelect={selectFromChart} onDrag={dragNode} /> : <Artwork graph={visible} points={positions} selected={picked} highlighted={highlighted} scale={camera.scale} onSelect={selectFromChart} onDrag={dragNode} />)}</g>
      </svg><div className="rm-map-controls"><button aria-label="Zoom out" onClick={() => changeCamera(zoomCamera(cameraRef.current, 0.8, { x: 800, y: 580 }))}><Minus size={17} /></button><span>{Math.round(camera.scale * 100)}%</span><button aria-label="Zoom in" onClick={() => changeCamera(zoomCamera(cameraRef.current, 1.25, { x: 800, y: 580 }))}><Plus size={17} /></button><button aria-label="Center selected node" onClick={focus}><Crosshair size={17} /></button><button aria-label="Open map fullscreen" onClick={() => { const container = svg.current?.closest(".rm-canvas"); if (container instanceof HTMLElement) void container.requestFullscreen().catch(() => setError("Fullscreen is unavailable in this browser.")); }}><ArrowsOut size={17} /></button><button className="rm-control-label" onClick={() => changeCamera(fitCamera(visiblePositions))}>Fit graph</button><button className="rm-control-label" aria-pressed={arrange} onClick={() => setArrange((value) => !value)}>Arrange nodes</button><button aria-label="Reset graph layout and filters" onClick={reset}><ArrowsCounterClockwise size={17} /></button></div><p className="rm-map-hint">Drag to pan · Scroll to zoom · Click for details · Double-click a company to open it</p>
      <svg className="rm-minimap" viewBox="0 0 200 120" role="button" tabIndex={0} aria-label="Graph minimap. Click to move the viewport; press Enter to fit the graph." onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const x = (event.clientX - rect.left) * 200 / rect.width, y = (event.clientY - rect.top) * 120 / rect.height; changeCamera(centeredCamera({ x: (x - miniature.x) / miniature.scale, y: (y - miniature.y) / miniature.scale }, camera.scale)); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); changeCamera(fitCamera(visiblePositions)); } }}>
        <rect width="200" height="120" rx="8" fill="#0d1b25" />{visible?.nodes.map((node) => { const point = positions[node.id]; return point ? <circle key={node.id} cx={point.x * miniature.scale + miniature.x} cy={point.y * miniature.scale + miniature.y} r={node.kind === "company" ? 2.5 : 1.1} fill={layerDesign[node.kind].color} opacity={node.kind === "company" ? 1 : 0.4} /> : null; })}<rect x={-camera.x / camera.scale * miniature.scale + miniature.x} y={-camera.y / camera.scale * miniature.scale + miniature.y} width={1600 / camera.scale * miniature.scale} height={1160 / camera.scale * miniature.scale} rx="3" fill="#75d6be15" stroke="#75d6be" strokeWidth="0.7" />
      </svg>
      {hover && hovered && <div className="rm-node-preview" style={{ left: hover.x, top: hover.y }}><small style={{ color: layerDesign[hovered.kind].color }}>{layerDesign[hovered.kind].label} · {hovered.status.replaceAll("_", " ")}</small><strong>{hovered.label}</strong><p>{hovered.kind === "person" ? `${hovered.subtitle} · ${fact(hovered, "Email") || "No address recorded"}` : hovered.subtitle}</p><span>{hovered.kind === "company" ? `${fact(hovered, "Industry") || "Industry unknown"} · ${fact(hovered, "Outreach list") || "Target list"}` : dateLabel(hovered)}</span><em>Click for details{hovered.kind === "company" ? " · Double-click to explore" : ""}</em></div>}
      {loading && <div className="rm-loading" role="status">Loading this company’s complete relationships…</div>}{!graph && <div className="rm-loading">No companies are available to explore.</div>}{visible && metrics && !loading && visible.nodes.length <= 1 && <p className="rm-empty">No additional records match the current layers and search.</p>}
    </section>{selected && <aside className="rm-inspector" aria-label="Selected relationship details">
      <button className="rm-close-inspector" aria-label="Close node details" onClick={() => setPicked(null)}><X size={16} /></button>
      {selected ? <><div className="rm-inspector-kind"><i style={{ background: layerDesign[selected.kind].color }} />{layerDesign[selected.kind].label}<span>{selected.status}</span></div><h2>{selected.label}</h2><p className="rm-subtitle">{selected.subtitle}</p><p className="rm-detail">{selected.detail}</p>{selected.at && <p className="rm-date">{dateLabel(selected)}</p>}<dl>{selected.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl><div className="rm-inspector-actions">{selected.kind === "company" && <button disabled={loading} onClick={() => { void loadCompany(selected.subtitle); }}>Open company graph <ArrowUpRight size={15} /></button>}{selected.kind !== "company" && selected.companyId && <button onClick={() => { const company = initialCompanies.find((company) => company.id === selected.companyId); if (company) void loadCompany(company.domain); }}>View company graph <ArrowUpRight size={15} /></button>}{selected.href && <Link href={selected.href}>Open record <ArrowUpRight size={15} /></Link>}{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Original source <ArrowUpRight size={15} /></a>}{selected.kind === "email" && <button onClick={() => { void navigator.clipboard.writeText(selected.label).then(() => setCopied(selected.id)).catch(() => setError("Could not copy this address. Select the address text to copy it.")); }}>{copied === selected.id ? "Address copied" : "Copy address"}</button>}<button onClick={() => { focus(); }}>Center node <Crosshair size={15} /></button></div><EvidencePanel graph={scopedGraph!} node={selected} onSelect={choose} /><label className="rm-isolate"><input type="checkbox" checked={isolated} onChange={(event) => setIsolated(event.target.checked)} /> Show this connection path only</label>
      {path.length > 1 && <div className="rm-path"><h3>Path from company</h3>{path.map((id, index) => { const node = graph!.nodes.find((node) => node.id === id)!; return <button key={id} onClick={() => choose(id)}><small>{String(index + 1).padStart(2, "0")}</small><i style={{ background: layerDesign[node.kind].color }} /><span>{shortLabel(node, 40)}</span></button>; })}</div>}
      <div className="rm-connections"><h3>Direct connections <span>{adjacent?.edges.length ?? 0}</span></h3>{adjacent?.edges.map((edge) => { const id = edge.from === selected.id ? edge.to : edge.from; const node = graph!.nodes.find((node) => node.id === id)!; return <button key={edge.id} onClick={() => choose(id)}><i style={{ background: layerDesign[node.kind].color }} /><span><strong>{shortLabel(node, 40)}</strong><small>{edge.from === selected.id ? edge.label : `Connected by: ${edge.label}`}</small></span><CaretRight size={14} /></button>; })}{!adjacent?.edges.length && <p>No linked records are loaded for this node.</p>}</div></> : <><h2>Explore the portfolio</h2><p>Choose a node to see its source, recorded state and direct relationships.</p></>}
      <details className="rm-legend"><summary>About the layers</summary>{layers.map((kind) => <p key={kind}><i style={{ background: layerDesign[kind].color }} /><span><b>{layerDesign[kind].label}</b>{layerDesign[kind].description}</span></p>)}</details><p className="rm-integrity">Every line comes from a recorded relationship. Missing data is not filled with inferred connections.</p>
    </aside>}</div>
  </div>;
}
