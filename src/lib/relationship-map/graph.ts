export const layers = ["company", "person", "draft", "outreach", "reply", "bounce", "signal", "job", "post", "discovery", "source", "seat"] as const;
export type Layer = (typeof layers)[number];
export type MapNode = { id: string; kind: Layer; label: string; subtitle: string; detail: string; status: string; companyId: string | null; href: string | null; sourceUrl: string | null; at: string | null; facts: Array<{ label: string; value: string }> };
export type MapEdge = { id: string; from: string; to: string; label: string };
export type RelationshipGraph = { nodes: MapNode[]; edges: MapEdge[]; warnings: string[]; companyId: string | null; loadedAt: string };
export type Company = { id: string; name: string; domain: string; status: string; outreach_stage?: string | null; outreach_owner?: string | null; vertical?: string | null; employee_range?: string | null; revenueUsdM?: number | null; revenueStatus?: string | null; revenueYear?: number | null; revenueSource?: string | null; outreachList?: string | null; listOwner?: string | null };
export type Person = { id: string; account_id: string; full_name: string; title: string; email: string | null; email_status: string; do_not_contact: boolean };
export type Draft = { id: string; account_id: string; person_id: string | null; signal_id: string | null; status: string; email_subject: string | null; email_body: string | null; brief: string | null; assigned_to: string; created_at: string };
export type Touch = { id: string; card_id: string; person_id: string; channel: string; sent_at: string | null; sent_by: string; reply_at: string | null; reply_classification: string | null; bounced_at: string | null };
export type Signal = { id: string; account_id: string; person_id: string | null; type: string; summary: string; source_url: string; observed_at: string | null };
export type Job = { id: string; account_id: string; title: string; url: string; active: boolean; posted_at: string | null; family: string | null };
export type Post = { id: string; account_id: string; person_id: string | null; author_name: string; topic: string; excerpt: string | null; url: string; posted_at: string | null };
export type Discovery = { id: string; company_domain: string | null; company_confirmed: boolean; status: string; owner: string | null; item: { title: string; text: string; url: string; provider: string; published_at: string | null; active: boolean } };
export type GraphRecords = { companies: Company[]; people: Person[]; drafts: Draft[]; touches: Touch[]; signals: Signal[]; jobs: Job[]; posts: Post[]; discoveries: Discovery[] };
const title = (value: string) => value.replaceAll("_", " ");
export function safeSourceUrl(raw: string | null | undefined) { if (!raw) return null; try { const url = new URL(raw); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; } catch { return null; } }
export function buildGraph(records: GraphRecords, warnings: string[] = [], now = Date.now()): RelationshipGraph {
  const nodes = new Map<string, MapNode>(); const edges: MapEdge[] = []; const edgeIds = new Set<string>();
  const add = (node: MapNode) => nodes.set(node.id, node);
  const link = (from: string, to: string, label: string) => { const id = `${from}:${to}:${label}`; if (from !== to && !edgeIds.has(id)) { edgeIds.add(id); edges.push({ id, from, to, label }); } };
  function source(raw: string, companyId: string, parent: string) {
    const url = safeSourceUrl(raw); if (!url) return;
    const id = `source:${url}`;
    if (!nodes.has(id)) add({ id, kind: "source", label: new URL(url).hostname.replace(/^www\./, ""), subtitle: "Published source", detail: "This is a source URL recorded by Night Watch. Open it to check the original evidence and current context.", status: "recorded", companyId, href: null, sourceUrl: url, at: null, facts: [{ label: "URL", value: url }] });
    link(parent, id, "cites source");
  }
  const peopleById = new Map(records.people.map((person) => [person.id, person]));
  const draftsById = new Map(records.drafts.map((draft) => [draft.id, draft]));
  const signalsById = new Map(records.signals.map((signal) => [signal.id, signal]));
  const companiesByDomain = new Map(records.companies.map((company) => [company.domain.toLowerCase().replace(/^www\./, ""), company]));
  const companies = new Map(records.companies.map((company) => [company.id, company]));
  for (const company of records.companies) add({ id: `company:${company.id}`, kind: "company", label: company.name, subtitle: company.domain, detail: `${company.name} is the company at the center of these records. Lines represent recorded membership, evidence, message preparation and delivery history.`, status: company.status, companyId: company.id, href: `/accounts/${encodeURIComponent(company.domain)}`, sourceUrl: null, at: null, facts: [{ label: "Domain", value: company.domain }, { label: "Industry", value: company.vertical || "Not recorded" }, { label: "Revenue", value: company.revenueUsdM == null ? "Not recorded" : `$${company.revenueUsdM}M · ${company.revenueStatus || "unconfirmed"}${company.revenueYear ? ` · ${company.revenueYear}` : ""}` }, { label: "Employees", value: company.employee_range || "Not recorded" }, { label: "Revenue source", value: company.revenueSource || "Not recorded" }, { label: "Outreach list", value: company.outreachList || "Not recorded" }, { label: "List owner", value: company.listOwner || "Not recorded" }, { label: "Outreach stage", value: title(company.outreach_stage || "Not recorded") }, { label: "Owner", value: company.outreach_owner || "Unassigned" }] });
  for (const person of records.people) {
    if (!companies.has(person.account_id)) continue;
    const id = `person:${person.id}`;
    add({ id, kind: "person", label: person.full_name || "Unnamed contact", subtitle: person.title, detail: person.do_not_contact ? "This contact is marked do not contact. The map does not change that restriction." : "A contact recorded for this company. Check the address and current role in the company page before outreach.", status: person.do_not_contact ? "do not contact" : person.email_status, companyId: person.account_id, href: `/accounts/${encodeURIComponent(companies.get(person.account_id)!.domain)}`, sourceUrl: null, at: null, facts: [{ label: "Role", value: person.title || "Not recorded" }, { label: "Email", value: person.email || "Not found" }, { label: "Address status", value: title(person.email_status) }, { label: "Contact permission", value: person.do_not_contact ? "Do not contact" : "Not suppressed in this record" }] });
    link(`company:${person.account_id}`, id, "has contact");
  }
  for (const signal of records.signals) {
    if (!companies.has(signal.account_id)) continue;
    const id = `signal:${signal.id}`; add({ id, kind: "signal", label: title(signal.type), subtitle: signal.summary, detail: signal.summary, status: "research evidence", companyId: signal.account_id, href: null, sourceUrl: safeSourceUrl(signal.source_url), at: signal.observed_at, facts: [{ label: "Evidence type", value: title(signal.type) }] });
    link(`company:${signal.account_id}`, id, "has research signal"); source(signal.source_url, signal.account_id, id);
    if (signal.person_id && peopleById.get(signal.person_id)?.account_id === signal.account_id) link(`person:${signal.person_id}`, id, "named in signal");
  }
  for (const job of records.jobs) {
    if (!companies.has(job.account_id)) continue;
    const id = `job:${job.id}`; add({ id, kind: "job", label: job.title, subtitle: job.family ? title(job.family) : "Job posting", detail: "A recorded job posting. Its active flag is the app's last observed state; verify the live posting before treating it as a current need.", status: job.active ? "active posting" : "inactive posting", companyId: job.account_id, href: `/accounts/${encodeURIComponent(companies.get(job.account_id)!.domain)}#evidence`, sourceUrl: safeSourceUrl(job.url), at: job.posted_at, facts: [{ label: "Family", value: job.family ? title(job.family) : "Unclassified" }] });
    link(`company:${job.account_id}`, id, "has job posting"); source(job.url, job.account_id, id);
  }
  for (const post of records.posts) {
    if (!companies.has(post.account_id)) continue;
    const id = `post:${post.id}`; add({ id, kind: "post", label: post.topic || "Employee post", subtitle: post.author_name, detail: post.excerpt || "No excerpt is stored. Open the original post for its content.", status: "recorded post", companyId: post.account_id, href: "/posts", sourceUrl: safeSourceUrl(post.url), at: post.posted_at, facts: [{ label: "Recorded author", value: post.author_name || "Not recorded" }] });
    link(`company:${post.account_id}`, id, "has employee post"); source(post.url, post.account_id, id);
    if (post.person_id && peopleById.get(post.person_id)?.account_id === post.account_id) link(`person:${post.person_id}`, id, "authored post");
  }
  for (const discovery of records.discoveries) {
    const company = discovery.company_confirmed && discovery.company_domain ? companiesByDomain.get(discovery.company_domain.toLowerCase().replace(/^www\./, "")) : null;
    if (!company) continue;
    const id = `discovery:${discovery.id}`; add({ id, kind: "discovery", label: discovery.item.title, subtitle: title(discovery.item.provider), detail: discovery.item.text, status: discovery.status, companyId: company.id, href: `/discovery#signal-${discovery.id}`, sourceUrl: safeSourceUrl(discovery.item.url), at: discovery.item.published_at, facts: [{ label: "Identity", value: "Company confirmed by reviewer" }, { label: "Source", value: title(discovery.item.provider) }, { label: "Owner", value: discovery.owner || "Unassigned" }] });
    link(`company:${company.id}`, id, "has confirmed discovery"); source(discovery.item.url, company.id, id);
  }
  for (const draft of records.drafts) {
    const company = companies.get(draft.account_id); if (!company) continue;
    const id = `draft:${draft.id}`; const candidate = draft.person_id ? peopleById.get(draft.person_id) : null; const person = candidate?.account_id === draft.account_id ? candidate : null;
    add({ id, kind: "draft", label: draft.email_subject || `Message for ${person?.full_name || company.name}`, subtitle: person?.full_name || company.name, detail: draft.email_body || draft.brief || "No email copy is stored for this card.", status: draft.status, companyId: company.id, href: `/desk?card=${draft.id}&account=${encodeURIComponent(company.domain)}`, sourceUrl: null, at: draft.created_at, facts: [{ label: "Assigned seat", value: draft.assigned_to }, { label: "Card state", value: title(draft.status) }] });
    link(`company:${company.id}`, id, "has message card");
    if (person) link(`person:${person.id}`, id, "message prepared for");
    if (draft.signal_id && signalsById.get(draft.signal_id)?.account_id === company.id) link(`signal:${draft.signal_id}`, id, "informs message");
  }
  for (const touch of records.touches) {
    const draft = draftsById.get(touch.card_id); if (!draft || !companies.has(draft.account_id) || !touch.sent_at) continue;
    const company = companies.get(draft.account_id)!; const id = `outreach:${touch.id}`; const candidate = peopleById.get(touch.person_id); const person = candidate?.account_id === company.id ? candidate : null;
    const href = `/desk?card=${draft.id}&account=${encodeURIComponent(company.domain)}`;
    add({ id, kind: "outreach", label: `${title(touch.channel)} sent`, subtitle: person?.full_name || company.name, detail: `A recorded ${title(touch.channel)} delivery by ${touch.sent_by}. Sending is not evidence that the recipient read it.`, status: touch.bounced_at ? "bounced" : touch.reply_at ? "replied" : "sent", companyId: company.id, href, sourceUrl: null, at: touch.sent_at, facts: [{ label: "Sender", value: touch.sent_by }, { label: "Channel", value: title(touch.channel) }] });
    link(`draft:${draft.id}`, id, "recorded delivery"); if (person) link(id, `person:${person.id}`, "sent to");
    const seatId = `seat:${touch.sent_by}`; if (!nodes.has(seatId)) add({ id: seatId, kind: "seat", label: title(touch.sent_by), subtitle: "Sending seat", detail: "This seat is recorded as the sender on connected deliveries.", status: "sending seat", companyId: null, href: "/activity", sourceUrl: null, at: null, facts: [] }); link(seatId, id, "sent message");
    if (touch.reply_at) { const reply = `reply:${touch.id}`; add({ id: reply, kind: "reply", label: title(touch.reply_classification || "Reply received"), subtitle: person?.full_name || company.name, detail: "A reply is recorded for this delivery. The label is the stored classification, not an inferred conversation or meeting.", status: touch.reply_classification || "received", companyId: company.id, href: "/replies", sourceUrl: null, at: touch.reply_at, facts: [{ label: "Classification", value: title(touch.reply_classification || "Not classified") }] }); link(id, reply, "received reply"); if (person) link(`person:${person.id}`, reply, "reply recorded from"); }
    if (touch.bounced_at) { const bounce = `bounce:${touch.id}`; add({ id: bounce, kind: "bounce", label: "Delivery bounced", subtitle: person?.full_name || company.name, detail: "A bounce was recorded for this delivery. Replacement address research and verification are handled by the existing recovery workflow.", status: "delivery failure", companyId: company.id, href: "/", sourceUrl: null, at: touch.bounced_at, facts: [] }); link(id, bounce, "delivery failed"); if (person) link(`person:${person.id}`, bounce, "failed delivery to"); }
  }
  return { nodes: [...nodes.values()], edges: edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to)), warnings, companyId: records.companies.length === 1 ? records.companies[0].id : null, loadedAt: new Date(now).toISOString() };
}
export function neighborhood(graph: RelationshipGraph, id: string) { const ids = new Set([id]); const connected = graph.edges.filter((edge) => edge.from === id || edge.to === id); for (const edge of connected) { ids.add(edge.from); ids.add(edge.to); } return { ids, edges: connected }; }
export function connectionPath(graph: RelationshipGraph, start: string, goal: string): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) { adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]); adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from]); }
  const queue = [start]; const prior = new Map<string, string | null>([[start, null]]);
  for (let index = 0; index < queue.length; index++) { const id = queue[index]; if (id === goal) { const path: string[] = []; let cursor: string | null = goal; while (cursor !== null) { path.unshift(cursor); cursor = prior.get(cursor) ?? null; } return path; } for (const next of adjacency.get(id) ?? []) if (!prior.has(next)) { prior.set(next, id); queue.push(next); } }
  return [];
}
export type Point = { x: number; y: number };
export function layoutGraph(graph: RelationshipGraph): Record<string, Point> {
  const points: Record<string, Point> = {}; const companyNodes = graph.nodes.filter((node) => node.kind === "company");
  const arcs: Record<Layer, [number, number, number]> = { company: [0, 0, 0], person: [260, -3.2, -1.7], draft: [285, -1.4, -0.25], outreach: [470, -1.3, -0.15], reply: [465, 0.1, 0.8], bounce: [550, 0.85, 1.2], signal: [290, 1.1, 2.15], job: [400, 1.4, 2.15], post: [475, 2.15, 2.55], discovery: [410, 2.6, 3.3], source: [625, 1.4, 3.5], seat: [580, -1.55, -1.25] };
  const ordered = [...companyNodes].sort((a, b) => (a.facts.find((fact) => fact.label === "Industry")?.value ?? "").localeCompare(b.facts.find((fact) => fact.label === "Industry")?.value ?? "") || a.label.localeCompare(b.label));
  const columns = Math.ceil(Math.sqrt(ordered.length));
  for (const [index, company] of ordered.entries()) points[company.id] = companyNodes.length === 1 ? { x: 0, y: 0 } : { x: (index % columns - (columns - 1) / 2) * 1800, y: (Math.floor(index / columns) - (Math.ceil(ordered.length / columns) - 1) / 2) * 1800 };
  for (const kind of layers.filter((kind) => kind !== "company")) {
    const groups = new Map<string, typeof graph.nodes>();
    for (const node of graph.nodes.filter((node) => node.kind === kind)) { const key = node.companyId ?? "shared"; const group = groups.get(key) ?? []; group.push(node); groups.set(key, group); }
    for (const [companyId, members] of groups) {
    const origin = points[`company:${companyId}`] ?? { x: 0, y: 0 };
    const group = members.sort((a, b) => a.id.localeCompare(b.id));
    for (const [index, node] of group.entries()) { const [radius, from, to] = arcs[kind]; const lane = Math.floor(index / 12); const ringCount = Math.min(12, group.length - lane * 12); const angle = from + (to - from) * (index % 12 + 0.5) / Math.max(1, ringCount); const r = radius + lane * 48; points[node.id] = { x: origin.x + Math.cos(angle) * r, y: origin.y + Math.sin(angle) * r }; }
    }
  }
  return points;
}
