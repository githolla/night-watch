"use client";
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import type { Company, MapNode, Point, RelationshipGraph } from "@/lib/relationship-map/graph";
import { layerDesign, shortLabel } from "@/lib/relationship-map/view";
import { companyStory, dateLabel, fact, recordedDate, statusTone, timelineNodes } from "@/lib/relationship-map/presentation";

const trim = (value: string, limit = 30) => value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
const glyph = (node: MapNode) => node.kind === "email" ? "@" : node.kind === "source" ? "↗" : node.kind === "outreach" ? "→" : node.kind === "bounce" ? "!" : node.kind === "reply" ? "↩" : node.kind === "company" ? node.label.slice(0, 2).toUpperCase() : node.kind === "person" ? node.label.split(/\s+/).slice(0, 2).map((part) => part[0]).join("") : "•";
export const JourneyArtwork = memo(function JourneyArtwork({ graph, points, selected, highlighted, onSelect, onDrag }: { graph: RelationshipGraph; points: Record<string, Point>; selected: string | null; highlighted: Set<string> | null; onSelect: (id: string) => void; onDrag: (id: string, event: ReactPointerEvent<SVGGElement>) => void }) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  return <>
    {graph.edges.map((edge) => {
      const from = points[edge.from], to = points[edge.to]; if (!from || !to) return null;
      const emphasized = selected === edge.from || selected === edge.to;
      const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
      const start = { x: from.x + (horizontal ? Math.sign(to.x - from.x) * 164 : 0), y: from.y + (!horizontal ? Math.sign(to.y - from.y) * 70 : 0) };
      const end = { x: to.x - (horizontal ? Math.sign(to.x - from.x) * 164 : 0), y: to.y - (!horizontal ? Math.sign(to.y - from.y) * 70 : 0) };
      const direction = Math.sign(end.x - start.x) || 1;
      const bypass = Math.min(start.y, end.y) - 160;
      const verticalDirection = Math.sign(end.y - start.y) || 1;
      const path = horizontal && Math.abs(to.x - from.x) > 600 ? `M${start.x},${start.y} C${start.x + direction * 45},${start.y} ${start.x + direction * 45},${bypass} ${start.x + direction * 90},${bypass} L${end.x - direction * 90},${bypass} C${end.x - direction * 45},${bypass} ${end.x - direction * 45},${end.y} ${end.x},${end.y}` : !horizontal && from.x === to.x && Math.abs(to.y - from.y) > 250 ? `M${start.x},${start.y} C${start.x + 230},${start.y} ${start.x + 230},${start.y} ${start.x + 230},${start.y + verticalDirection * 40} L${end.x + 230},${end.y - verticalDirection * 40} C${end.x + 230},${end.y} ${end.x + 230},${end.y} ${end.x},${end.y}` : horizontal ? `M${start.x},${start.y} C${(start.x + end.x) / 2},${start.y} ${(start.x + end.x) / 2},${end.y} ${end.x},${end.y}` : `M${start.x},${start.y} C${start.x},${(start.y + end.y) / 2} ${end.x},${(start.y + end.y) / 2} ${end.x},${end.y}`;
      return <g key={edge.id}><path d={path} className={`rm-edge rm-journey-edge ${emphasized ? "is-emphasized" : ""}`} stroke={layerDesign[byId.get(edge.to)!.kind].color} opacity={highlighted && !(highlighted.has(edge.from) && highlighted.has(edge.to)) ? 0.08 : emphasized ? 0.9 : 0.38} markerEnd="url(#rm-arrow)"><title>{`${byId.get(edge.from)?.label} → ${edge.label} → ${byId.get(edge.to)?.label}`}</title></path>{emphasized && horizontal && Math.abs(to.x - from.x) > 600 && <text x={(start.x + end.x) / 2} y={bypass - 12} textAnchor="middle" className="rm-journey-edge-label">{edge.label}</text>}</g>;
    })}
    {graph.nodes.map((node) => {
      const point = points[node.id]; if (!point) return null;
      const color = layerDesign[node.kind].color, picked = selected === node.id;
      const second = node.kind === "source" && node.sourceUrl ? new URL(node.sourceUrl).pathname : node.kind === "person" ? node.subtitle : node.kind === "outreach" ? fact(node, "Subject") || node.subtitle : node.kind === "company" ? fact(node, "Industry") || node.subtitle : node.kind === "email" ? `Current address · ${node.status.replaceAll("_", " ")}` : node.subtitle;
      const sourceDates = node.kind === "source" ? graph.edges.filter((edge) => edge.to === node.id).map((edge) => byId.get(edge.from)).filter((item): item is MapNode => Boolean(item?.at)) : [];
      const stamp = node.kind === "company" ? fact(node, "Outreach list") || "Target company" : node.kind === "seat" ? "Recorded sending seat" : node.kind === "source" && sourceDates.length ? `Evidence ${recordedDate(sourceDates[0].at)}${sourceDates.length > 1 ? ` +${sourceDates.length - 1}` : ""}` : dateLabel(node);
      return <g key={node.id} transform={`translate(${point.x},${point.y})`} className={`rm-node rm-journey-card is-${node.kind} ${picked ? "is-picked" : ""}`} opacity={highlighted && !highlighted.has(node.id) ? 0.22 : 1} data-map-node={node.id} role="button" tabIndex={0} aria-label={`${layerDesign[node.kind].label}: ${node.label}, ${node.status}`} aria-pressed={picked} onPointerDown={(event) => onDrag(node.id, event)} onClick={() => onSelect(node.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(node.id); } }}>
        <title>{`${node.label} · ${second} · ${stamp} · ${node.status}`}</title>
        {picked && <rect x="-172" y="-80" width="344" height="160" rx="17" fill="none" stroke={color} opacity="0.35" strokeWidth="2" />}
        <rect x="-164" y="-72" width="328" height="144" rx="12" fill={node.kind === "company" ? "#20231d" : "#111f2a"} stroke={picked ? color : "#344653"} strokeWidth={picked ? "2" : "1"} />
        <rect x="-164" y="-56" width="3" height="112" rx="1.5" fill={color} />
        <rect x="-146" y="-54" width="31" height="31" rx="8" fill={color} opacity="0.1" /><text x="-130" y="-31" textAnchor="middle" className="rm-journey-icon" fill={color}>{glyph(node)}</text>
        <text x="-105" y="-35" className="rm-journey-kind" fill={color}>{layerDesign[node.kind].label.toUpperCase()}</text>
        <text x="-146" y="0" className="rm-journey-title">{trim(node.label, 26)}</text>
        <text x="-146" y="25" className="rm-journey-secondary">{trim(second, 37)}</text>
        <line x1="-146" y1="39" x2="146" y2="39" stroke="#2b3d49" />
        <circle cx="-142" cy="55" r="3" className={`rm-svg-status is-${statusTone(node)}`} /><text x="-132" y="60" className="rm-journey-date">{trim(stamp, 37)}</text>
      </g>;
    })}
  </>;
});

export function CompanyOverview({ graph, companies, selected, ready, onSelect, onOpen }: { graph: RelationshipGraph; companies: Company[]; selected: string | null; ready: boolean; onSelect: (id: string) => void; onOpen: (domain: string) => void }) {
  const roots = graph.nodes.filter((node) => node.kind === "company");
  const groups = [...new Set(roots.map((node) => fact(node, "Outreach list") || "Target companies"))].sort((a, b) => a.startsWith("Today's") ? -1 : b.startsWith("Today's") ? 1 : a.localeCompare(b));
  return <div className="rm-company-overview">{groups.map((group) => <section key={group} className="rm-company-group"><header><div><span>OUTREACH LIST</span><h3>{group}</h3></div><b>{roots.filter((node) => (fact(node, "Outreach list") || "Target companies") === group).length} companies</b></header><div className="rm-company-grid">{roots.filter((node) => (fact(node, "Outreach list") || "Target companies") === group).map((company) => {
    const story = companyStory(graph, company.companyId!), contact = story.contacts[0], firstAddress = story.addresses[0];
    const address = contact ? story.addresses.find((node) => graph.edges.some((edge) => edge.from === contact.id && edge.to === node.id && edge.label === "has current address")) : null;
    const sourceRecord = story.sources[0] ? story.nodes.find((node) => graph.edges.some((edge) => edge.from === node.id && edge.to === story.sources[0].id) && node.at) : null;
    const size = companies.find((item) => item.id === company.companyId);
    return <article key={company.id} className={`rm-company-story ${selected === company.id ? "is-selected" : ""}`}>
      <div className="rm-story-top"><span className="rm-company-mark">{company.label.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><div><button className="rm-story-title" onClick={() => onSelect(company.id)}>{company.label}</button><small>{company.subtitle}</small></div><span className={`rm-status-pill ${story.bounces.length ? "is-danger" : story.replies.length ? "is-success" : "is-neutral"}`}>{!ready ? "Loading" : story.bounces.length ? "Bounce on file" : story.replies.length ? "Replied" : story.sent.length ? "Sent" : "Not sent"}</span></div>
      <div className="rm-story-meta"><span>{size?.vertical || "Industry not recorded"}</span><span>{size?.revenueUsdM != null ? `$${size.revenueUsdM}M · ${size.revenueStatus || "unconfirmed"}` : "Revenue not recorded"}</span></div>
      <div className="rm-mini-flow" aria-label="Company relationship summary"><button disabled={!story.sources[0]} onClick={() => story.sources[0] && onSelect(story.sources[0].id)}><i className="is-source">↗</i><span>Sources</span><b>{ready ? story.sources.length : "…"}</b></button><span className="rm-mini-line" /><button disabled={!contact} onClick={() => contact && onSelect(contact.id)}><i className="is-contact">◎</i><span>Contacts</span><b>{ready ? story.contacts.length : "…"}</b></button><span className="rm-mini-line" /><button disabled={!firstAddress} onClick={() => firstAddress && onSelect(firstAddress.id)}><i className="is-email">@</i><span>Emails</span><b>{ready ? story.addresses.length : "…"}</b></button><span className="rm-mini-line" /><button disabled={!story.sent[0]} onClick={() => story.sent[0] && onSelect(story.sent[0].id)}><i className="is-sent">→</i><span>Sent</span><b>{ready ? story.sent.length : "…"}</b></button></div>
      <div className="rm-story-contact">{contact ? <><button onClick={() => onSelect(contact.id)}>{contact.label}<small>{contact.subtitle}</small></button>{address ? <button className={`rm-story-address is-${statusTone(address)}`} onClick={() => onSelect(address.id)}><span>{address.label}</span><small>{address.status.replaceAll("_", " ")}</small></button> : <p>No current address for this contact</p>}{story.contacts.length > 1 && <button className="rm-more-contacts" onClick={() => onOpen(company.subtitle)}>+{story.contacts.length - 1} more contacts →</button>}</> : <p>{ready ? "No contacts recorded" : "Loading contact details…"}</p>}</div>
      {story.sources[0] && <div className="rm-story-source"><a href={story.sources[0].sourceUrl!} target="_blank" rel="noopener noreferrer">↗ {story.sources[0].label}</a><small>{sourceRecord ? dateLabel(sourceRecord) : "Evidence date not recorded"}</small></div>}
      <footer><span>{story.latest ? <><i />{dateLabel(story.latest)}</> : ready ? "Activity date not recorded" : "Loading activity…"}</span><button onClick={() => onOpen(company.subtitle)}>Explore graph <span>↗</span></button></footer>
    </article>;
  })}</div></section>)}{!roots.length && <p className="rm-view-empty">No target companies match these filters.</p>}</div>;
}

export function RelationshipTimeline({ graph, selected, onSelect }: { graph: RelationshipGraph; selected: string | null; onSelect: (id: string) => void }) {
  const events = timelineNodes(graph);
  return <div className="rm-timeline"><header><h3>Recorded activity</h3><p>Research, address verification, prepared messages, sends and responses, ordered by their stored dates.</p></header>{events.map((node) => <button key={node.id} className={`rm-timeline-event ${selected === node.id ? "is-selected" : ""}`} onClick={() => onSelect(node.id)}><span className="rm-timeline-date">{recordedDate(node.at, true)}</span><i style={{ background: layerDesign[node.kind].color }} /><span><small>{layerDesign[node.kind].label} · {node.status.replaceAll("_", " ")}</small><strong>{shortLabel(node, 65)}</strong><em>{node.kind === "outreach" ? fact(node, "Subject") : node.subtitle}</em></span><span>↗</span></button>)}{!events.length && <p className="rm-view-empty">No dated records match these filters. Records without dates remain available in Companies, Network and List.</p>}</div>;
}

export function EvidencePanel({ graph, node, onSelect, onTimeline }: { graph: RelationshipGraph; node: MapNode; onSelect: (id: string) => void; onTimeline?: () => void }) {
  const story = node.companyId ? companyStory(graph, node.companyId) : null;
  const linked = graph.edges.filter((edge) => edge.from === node.id || edge.to === node.id).map((edge) => graph.nodes.find((item) => item.id === (edge.from === node.id ? edge.to : edge.from))).filter((item): item is MapNode => Boolean(item));
  const sources = node.kind === "company" ? story?.sources ?? [] : linked.filter((item) => item.kind === "source");
  const events = node.kind === "company" ? story?.events ?? [] : linked.filter((item) => item.at).sort((a, b) => new Date(b.at!).getTime() - new Date(a.at!).getTime());
  return <>{sources.length > 0 && <section className="rm-evidence-panel"><h3>Original sources <span>{sources.length}</span></h3>{sources.map((source) => <div key={source.id}><button onClick={() => onSelect(source.id)}>{source.label}</button><a href={source.sourceUrl!} target="_blank" rel="noopener noreferrer">Open source ↗</a><small>{new URL(source.sourceUrl!).pathname}</small></div>)}</section>}{events.length > 0 && <section className="rm-evidence-panel"><h3>{node.kind === "source" ? "Dated evidence citing this source" : "Recorded activity"}</h3>{events.slice(0, 8).map((event) => <button className="rm-evidence-event" key={event.id} onClick={() => onSelect(event.id)}><i style={{ background: layerDesign[event.kind].color }} /><span>{shortLabel(event, 42)}<small>{dateLabel(event)}</small></span></button>)}{events.length > 8 && <p>{events.length - 8} more dated records. Select a linked node to inspect its date.</p>}</section>}{node.kind === "company" && story && <div className="rm-company-inspector-stats"><span><b>{story.contacts.length}</b>contacts</span><span><b>{story.sent.length}</b>sent</span><span><b>{story.replies.length}</b>replies</span><span><b>{story.bounces.length}</b>bounces</span></div>}{node.kind === "email" && <p className="rm-current-address-note">Current address on file. Sent history is linked to the contact.</p>}{node.kind === "source" && <p className="rm-current-address-note">Dates here belong to the linked evidence records. A publication date for the source itself is not recorded.</p>}{onTimeline && <button className="rm-inspector-timeline-link" onClick={onTimeline}>View recorded dates in Timeline →</button>}</>;
}
