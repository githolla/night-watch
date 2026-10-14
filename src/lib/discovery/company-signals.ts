import { checkedAssessment, itemSchema, type Assessment, type DiscoveryItem, type SourceConfig } from "./domain.ts";

export const signalRules = [
  { category: "hiring", label: "Hiring and capacity", match: /\b(?:we(?:'re| are) hiring|open positions|now hiring|seeking (?:an? |experienced )?(?:operations|analyst|coordinator|manager)|job opening)\b/i, buyer: "Operations leader", angle: "Ask which recurring tasks the new hire will own and whether software could support that work." },
  { category: "expansion", label: "Expansion", match: /\b(?:opened? (?:a |our |its )?new|new (?:branch|facility|office|location|distribution center)|expand(?:s|ing|ed)? (?:into|operations|our|its)|grand opening)\b/i, buyer: "COO or regional operations leader", angle: "Explore how the growing locations share records, approvals and customer handoffs." },
  { category: "acquisition", label: "Acquisition or merger", match: /\b(?:acquired|acquisition of|merges? with|merger with|acquires|acquiring)\b/i, buyer: "Integration or operations leader", angle: "Ask about connecting acquired teams and systems without assuming an integration problem." },
  { category: "leadership", label: "Leadership change", match: /\b(?:appointed|named|promoted to|joins? as)\b.{0,100}\b(?:president|chief|ceo|coo|director|vice president)\b/i, buyer: "The newly appointed operating leader", angle: "Research the leader's stated priorities before proposing a specific workflow." },
  { category: "technology", label: "Existing software", match: /\b(?:uses?|using|powered by|implemented|integrat(?:es|ed|ion) with|migrat(?:ed|ing) to)\b.{0,100}\b(?:CRM|ERP|Salesforce|NetSuite|FieldRoutes|ServiceTitan|Microsoft Dynamics|SAP|HubSpot|software|platform)\b/i, buyer: "Operations or systems leader", angle: "Look for work outside the existing platform and propose an extension rather than replacing tools they already use." },
  { category: "contract", label: "Contract or partnership", match: /\b(?:awarded (?:a |the )?contract|won (?:a |the )?contract|selected (?:as|to)|announces? (?:a |new )?partnership|partners? with)\b/i, buyer: "Delivery or operations leader", angle: "Explore reporting, documentation and delivery handoffs associated with the announced work." },
  { category: "compliance", label: "Compliance and certification", match: /\b(?:achieved|received|earned|renewed)\b.{0,100}\b(?:certification|accreditation|ISO 9001|SOC 2)\b/i, buyer: "Quality or compliance leader", angle: "Ask how evidence collection and recurring documentation fit into daily operations." },
  { category: "operational_pain", label: "Publicly described workflow need", match: /\b(?:manual (?:process|reporting|data entry)|duplicate data entry|spreadsheet(?:s)?|disconnected systems|time.consuming|backlog|bottleneck)\b/i, buyer: "The operating team responsible for this workflow", angle: "Determine whether the described workflow belongs to this company before proposing automation." },
] as const;

function clean(raw: string) { return raw.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (_, code: string) => Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : " ").replace(/&amp;/g, "&").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&hellip;/g, "...").replace(/\s+/g, " ").trim(); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function structured(html: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const visit = (value: unknown, depth = 0) => { if (depth > 8) return; if (Array.isArray(value)) { value.slice(0, 100).forEach(item => visit(item, depth + 1)); return; } const row = record(value); if (row["@type"]) rows.push(row); if (row["@graph"]) visit(row["@graph"], depth + 1); };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) { try { visit(JSON.parse(match[1])); } catch { /* Malformed publisher metadata cannot supply a date. */ } }
  return rows;
}
function timestamp(value: unknown) { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null; const time = Date.parse(value); return Number.isFinite(time) ? new Date(time).toISOString() : null; }
export function companyLinks(html: string, pageUrl: string, domain: string): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try { const url = new URL(match[1].replace(/&amp;/g, "&"), pageUrl); if (url.protocol !== "https:" || url.username || url.password || ![domain, `www.${domain}`].includes(url.hostname) || /\.(pdf|png|jpg|zip)$/i.test(url.pathname)) continue; url.hash = "";
      if (/news|blog|insight|press|career|jobs|about|team|leader|acquir|expand|partner|case.stud|technology|award|certif/i.test(`${url.pathname} ${clean(match[2])}`)) { for (const key of [...url.searchParams.keys()]) if (/^utm_|^hsLang$/.test(key)) url.searchParams.delete(key); links.add(url.toString()); }
    } catch { /* Ignore unusable links. */ }
  }
  const priority = (url: string) => /\/(news|blog|press|insights)\/[^/?]+/i.test(url) ? 10 : /acquir|expand|case.stud|technology/i.test(url) ? 9 : /news|blog|press|insight/i.test(url) ? 8 : /career|jobs/i.test(url) ? 7 : /team|leader/i.test(url) ? 4 : 2;
  return [...links].sort((a, b) => priority(b) - priority(a)).slice(0, 30);
}
export function companyPageItems(html: string, url: string, source: SourceConfig, now: number): DiscoveryItem[] {
  const metadata = structured(html);
  const articles = metadata.filter(row => (Array.isArray(row["@type"]) ? row["@type"] : [row["@type"]]).some(type => /^(NewsArticle|Article|BlogPosting)$/.test(String(type))));
  const article = articles.length === 1 ? articles[0] : undefined;
  const published = timestamp(article?.datePublished);
  const paragraphs = [...html.replace(/<(script|style|nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").matchAll(/<(p|h[1-3]|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(match => clean(match[2])).filter(text => text.length >= 45 && text.length <= 3000);
  const output: DiscoveryItem[] = [];
  const make = (category: string, title: string, text: string, at: string | null, deadline: string | null = null) => itemSchema.parse({ provider: "company_site", source_id: source.id, external_id: `${url}:${category}`, url, title: title.slice(0, 1000), text: text.slice(0, 20000), published_at: at, observed_at: new Date(now).toISOString(), company: source.company, domain: source.domain, owner: source.owner, kind: category === "hiring" ? "hiring" : "company_change", signal_category: category, partial: true, active: !deadline || Date.parse(deadline) > now, deadline, permission_reference: source.permission_reference });
  for (const job of metadata.filter(row => row["@type"] === "JobPosting").slice(0, 6)) {
    const title = typeof job.title === "string" ? clean(job.title) : ""; const description = typeof job.description === "string" ? clean(job.description) : "";
    const organization = record(job.hiringOrganization); const named = typeof organization.name === "string" ? organization.name.toLowerCase() : "";
    if (!title || !description || (named && !source.company.toLowerCase().includes(named) && !named.includes(source.company.toLowerCase()))) continue;
    const jobItem = make("hiring", title, description, timestamp(job.datePosted), timestamp(job.validThrough));
    output.push({ ...jobItem, external_id: `${url}:job:${title}`, partial: false });
  }
  const year = new Date(now).getUTCFullYear();
  for (const rule of signalRules) {
    const text = paragraphs.find(text => {
      const historicalYear = /^(?:In\s+)?(19\d{2}|20\d{2})\b/.exec(text);
      if (historicalYear && Number(historicalYear[1]) < year - 1) return false;
      if (rule.category === "acquisition" && /\bacquired (?:companies|businesses|skills|knowledge)\b/i.test(text)) return false;
      return rule.match.test(text);
    });
    if (!text) continue;
    output.push(make(rule.category, `${source.company}: ${rule.label}`, text, published));
  }
  return output.slice(0, 12);
}

/** A transparent review aid, never a claim of buying intent or a fabricated model result. */
export function assessCompanySignal(item: DiscoveryItem): Assessment | null {
  if (item.provider !== "company_site") return null;
  const rule = signalRules.find(rule => rule.category === item.signal_category);
  if (!rule || !item.active) return null;
  const quote = item.text.slice(0, 260);
  return checkedAssessment({ relevant: true, summary: `Company-published ${rule.label.toLowerCase()}. This is a research clue; an internal need and interest in Nine-67 are not established.`, problem: rule.category === "technology" ? "integration" : ["acquisition", "expansion"].includes(rule.category) ? "handoffs" : "manual_operations", evidence: [{ quote, supports: `The source describes ${rule.label.toLowerCase()}.` }], unknowns: ["Internal workflow need, budget and vendor interest are unknown.", ...(!item.published_at ? ["Publication date is unknown; first observation is not an event date."] : []), "The statement may refer to a customer or partner; review attribution."], confidence: item.published_at ? 0.65 : 0.55, fit: 25, intent: rule.category === "operational_pain" ? 12 : 5, actionability: 15, why_now: item.published_at ? `Publisher dates this source ${item.published_at.slice(0, 10)}. Check event timing before outreach.` : "Newly observed context with no confirmed event date.", suggested_buyer: rule.buyer, next_step: rule.angle, asset: "A short workflow map showing the current handoff, proposed change and questions to resolve." }, item);
}
