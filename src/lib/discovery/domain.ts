import { z } from "zod";

export const providers = ["greenhouse", "lever", "gdelt", "hacker_news", "sam", "sec", "feed"] as const;
export const providerSchema = z.enum(providers);
export type Provider = z.infer<typeof providerSchema>;
export const domainSchema = z.string().trim().toLowerCase().regex(/^(?!.*\.example$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/);
export const publicUrlSchema = z.string().url().refine((raw) => { const url = new URL(raw); return url.protocol === "https:" && !url.username && !url.password; }, "Use a public HTTPS URL.");
export const sourceConfigSchema = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), provider: providerSchema, label: z.string().min(1).max(150), enabled: z.boolean(), value: z.string().max(500), company: z.string().max(200).default(""), domain: z.union([domainSchema, z.literal("")]).default(""), permission_reference: z.string().max(500).default("") }).strict();
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export const configSchema = z.object({ enabled: z.boolean(), sources: z.array(sourceConfigSchema).max(30), keywords: z.array(z.string().min(2).max(80)).min(1).max(20), max_sources: z.number().int().min(1).max(12), max_items: z.number().int().min(1).max(30), max_analysis: z.number().int().min(0).max(12), cost_cap_usd: z.number().min(0.1).max(10), retention_days: z.number().int().min(7).max(90) }).strict().superRefine((config, ctx) => {
  if (new Set(config.sources.map((source) => source.id)).size !== config.sources.length) ctx.addIssue({ code: "custom", message: "Source IDs must be unique." });
  config.sources.forEach((source, index) => {
    if (["greenhouse", "lever"].includes(source.provider) && (!/^[A-Za-z0-9_-]+$/.test(source.value) || !source.company || !source.domain)) ctx.addIssue({ code: "custom", path: ["sources", index], message: "Job boards require a board ID, company name and domain." });
    if (source.provider === "feed" && (!publicUrlSchema.safeParse(source.value).success || !source.permission_reference.trim())) ctx.addIssue({ code: "custom", path: ["sources", index], message: "Feeds require a public HTTPS URL and a reference permitting this use." });
    if (source.provider === "sec" && (!/^\d{1,10}$/.test(source.value) || !source.company || !source.domain)) ctx.addIssue({ code: "custom", path: ["sources", index], message: "SEC sources require a CIK, company name and domain." });
  });
});
export type DiscoveryConfig = z.infer<typeof configSchema>;
export const defaultConfig: DiscoveryConfig = { enabled: true, max_sources: 6, max_items: 20, max_analysis: 6, cost_cap_usd: 2, retention_days: 30,
  keywords: ["CRM", "reporting", "workflow", "integration", "manual process", "operations", "automation", "spreadsheet"],
  sources: [
    { id: "business_changes", provider: "gdelt", label: "Business expansion and systems changes", value: '("expands operations" OR "new locations" OR "CRM implementation" OR "digital transformation") sourcelang:english', enabled: true, company: "", domain: "", permission_reference: "GDELT open-data API; article metadata only" },
    { id: "operator_questions", provider: "hacker_news", label: "Operator questions on Hacker News", value: "", enabled: true, company: "", domain: "", permission_reference: "Official public Hacker News read API" },
    { id: "buying_requests", provider: "sam", label: "Federal systems and reporting requests", value: "541512", enabled: true, company: "", domain: "", permission_reference: "SAM.gov public opportunities API" },
  ],
};
export const itemSchema = z.object({ provider: providerSchema, external_id: z.string().min(1).max(500), source_id: z.string(), url: publicUrlSchema, title: z.string().min(1).max(1000), text: z.string().max(20000), published_at: z.string().datetime().nullable(), observed_at: z.string().datetime(), company: z.string().max(200).nullable(), domain: domainSchema.nullable(), kind: z.enum(["hiring", "company_change", "buying_request", "discussion", "filing"]), partial: z.boolean(), deadline: z.string().datetime().nullable(), active: z.boolean(), permission_reference: z.string() });
export type DiscoveryItem = z.infer<typeof itemSchema>;
export const assessmentSchema = z.object({ relevant: z.boolean(), summary: z.string().max(1000), problem: z.enum(["crm_hygiene", "reporting", "handoffs", "integration", "manual_operations", "other"]), evidence: z.array(z.object({ quote: z.string().min(8).max(600), supports: z.string().min(1).max(300) })).min(1).max(5), unknowns: z.array(z.string().max(200)).max(10), confidence: z.number().min(0).max(1), fit: z.number().int().min(0).max(40), intent: z.number().int().min(0).max(25), actionability: z.number().int().min(0).max(20), why_now: z.string().max(1000), suggested_buyer: z.string().max(200), next_step: z.string().max(600), asset: z.string().max(1000) });
export type Assessment = z.infer<typeof assessmentSchema>;
export const statuses = ["new", "reviewed", "research_queued", "engaged", "qualified", "meeting", "dismissed"] as const;
export const opportunitySchema = z.object({ id: z.string(), item: itemSchema, assessment: assessmentSchema.nullable(), source_ids: z.array(z.string()), status: z.enum(statuses), owner: z.enum(["josh", "suuchi"]).nullable(), notes: z.string(), feedback: z.enum(["relevant", "irrelevant"]).nullable(), followup_at: z.string().nullable(), company_name: z.string().nullable(), company_domain: domainSchema.nullable(), company_evidence_url: publicUrlSchema.nullable(), company_confirmed: z.boolean(), promoted_candidate_id: z.string().nullable(), created_at: z.string(), checked_at: z.string(), updated_at: z.string(), version: z.number().int() });
export type DiscoveryOpportunity = z.infer<typeof opportunitySchema>;
export const patchSchema = opportunitySchema.pick({ status: true, owner: true, feedback: true }).partial().extend({ version: z.number().int().positive(), notes: z.string().max(4000).optional(), followup_at: z.string().datetime().nullable().optional(), company_name: z.string().min(2).max(200).nullable().optional(), company_domain: domainSchema.nullable().optional(), company_evidence_url: publicUrlSchema.nullable().optional(), company_confirmed: z.boolean().optional() }).strict();
export function checkedAssessment(value: unknown, item: DiscoveryItem) {
  const assessment = assessmentSchema.parse(value);
  for (const evidence of assessment.evidence) if (!`${item.title}\n${item.text}`.includes(evidence.quote)) throw new Error("Assessment quote was not present in the source.");
  if (item.partial && assessment.confidence > 0.7) assessment.confidence = 0.7;
  return assessment;
}
export function score(row: DiscoveryOpportunity, now: number) {
  if (!row.assessment || !row.item.active || (row.item.deadline && Date.parse(row.item.deadline) <= now)) return 0;
  if (now - Date.parse(row.checked_at) > 7 * 86400000) return 0;
  const stamp = row.item.published_at;
  const age = stamp ? (now - Date.parse(stamp)) / 86400000 : Infinity;
  if (Number.isFinite(age) && (age < 0 || age > 30)) return 0;
  const recency = age >= 0 && age <= 3 ? 15 : age >= 0 && age <= 7 ? 10 : age >= 0 && age <= 30 ? 5 : 0;
  return row.assessment.fit + row.assessment.intent + row.assessment.actionability + recency;
}
export function actionable(row: DiscoveryOpportunity, now: number) { return row.assessment?.relevant && row.assessment.confidence >= 0.65 && row.feedback !== "irrelevant" && row.status !== "dismissed" && score(row, now) >= 60; }
export function companyGroups(rows: DiscoveryOpportunity[]) {
  const map = new Map<string, DiscoveryOpportunity[]>();
  for (const row of rows) if (row.company_confirmed && row.company_domain && row.status !== "dismissed" && row.feedback !== "irrelevant") { const group = map.get(row.company_domain) ?? []; if (!group.some((item) => item.id === row.id)) group.push(row); map.set(row.company_domain, group); }
  return [...map].map(([domain, signals]) => ({ domain, signals, publishers: new Set(signals.map((row) => new URL(row.item.url).hostname)).size })).sort((a, b) => b.publishers - a.publishers || b.signals.length - a.signals.length);
}
export function problemGroups(rows: DiscoveryOpportunity[]) {
  const map = new Map<string, DiscoveryOpportunity[]>();
  for (const row of rows) if (row.assessment?.relevant && row.feedback !== "irrelevant" && row.status !== "dismissed") { const list = map.get(row.assessment.problem) ?? []; if (!list.some((item) => item.item.url === row.item.url)) list.push(row); map.set(row.assessment.problem, list); }
  return [...map].map(([problem, signals]) => ({ problem, signals })).filter((group) => group.signals.length >= 2).sort((a, b) => b.signals.length - a.signals.length);
}
export function sourcePlan(config: DiscoveryConfig, rows: DiscoveryOpportunity[], day: number) {
  const enabled = config.sources.filter((source) => source.enabled);
  const stats = enabled.map((source) => { const reviewed = rows.filter((row) => row.source_ids.includes(source.id) && row.feedback); const relevant = reviewed.filter((row) => row.feedback === "relevant").length; const qualified = reviewed.filter((row) => ["qualified", "meeting"].includes(row.status)).length; return { ...source, reviewed: reviewed.length, relevant, qualified, priority: (relevant + qualified + 2) / (reviewed.length + 4) }; });
  if (!stats.length) return [];
  const explore = stats[((day % stats.length) + stats.length) % stats.length];
  return [explore, ...stats.filter((source) => source.id !== explore.id).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))].slice(0, config.max_sources);
}
export function briefing(rows: DiscoveryOpportunity[], owner: "josh" | "suuchi", now: number) {
  return { actToday: rows.filter((row) => actionable(row, now) && ["new", "reviewed"].includes(row.status) && (!row.owner || row.owner === owner)).sort((a, b) => score(b, now) - score(a, now)).slice(0, 5), followup: rows.filter((row) => row.owner === owner && row.status !== "dismissed" && row.followup_at && Date.parse(row.followup_at) <= now), companies: companyGroups(rows), problems: problemGroups(rows).slice(0, 3) };
}
