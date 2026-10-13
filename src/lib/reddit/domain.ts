import { z } from "zod";

export const communitySchema = z.object({ name: z.string().regex(/^[A-Za-z0-9_]{2,30}$/), enabled: z.boolean(), rules: z.string().max(12000), rules_checked_at: z.string().datetime().nullable(), response_policy: z.enum(["unknown", "helpful_only", "no_commercial"]) });
export const querySchema = z.object({ id: z.string().regex(/^[a-z0-9_-]+$/), family: z.string().max(80), query: z.string().min(2).max(500), enabled: z.boolean() });
export const configSchema = z.object({ enabled: z.boolean(), communities: z.array(communitySchema).max(15), queries: z.array(querySchema).max(25), max_queries: z.number().int().min(1).max(8), max_threads: z.number().int().min(1).max(12), max_watches: z.number().int().min(1).max(8), cost_cap_usd: z.number().min(0.1).max(10), retention_days: z.number().int().min(1).max(30) });
export type RedditConfig = z.infer<typeof configSchema>;
export type Community = z.infer<typeof communitySchema>;
export const defaultConfig: RedditConfig = {
  enabled: false, max_queries: 5, max_threads: 6, max_watches: 4, cost_cap_usd: 2, retention_days: 7,
  communities: ["smallbusiness", "Entrepreneur", "startups", "sales", "CRM", "salesforce", "hubspot", "automation", "n8n", "zapier", "BusinessIntelligence", "accounting"].map((name) => ({ name, enabled: true, rules: "", rules_checked_at: null, response_policy: "unknown" })),
  queries: [
    { id: "buying", family: "Active purchasing", query: '("looking for" OR "recommend") AND (CRM OR automation OR reporting)' },
    { id: "friction", family: "Operational friction", query: '("manual" OR "spreadsheet") AND ("hours" OR "workflow" OR "reporting")' },
    { id: "alternatives", family: "Failed alternatives", query: '("replacing" OR "alternative" OR "frustrated") AND (CRM OR Zapier OR reporting)' },
    { id: "growth", family: "Growth pressure", query: '("scaling" OR "growing") AND ("operations" OR "process" OR "handoff")' },
    { id: "implementation", family: "Implementation difficulties", query: '("stuck" OR "help") AND ("integration" OR "automation" OR "dashboard")' },
    { id: "revops", family: "Revenue operations", query: '("lead routing" OR "sales reporting" OR "CRM cleanup")' },
  ].map((query) => ({ ...query, enabled: true })),
};
export const sourceSchema = z.object({ id: z.string().regex(/^[a-z0-9]+$/), subreddit: z.string(), permalink: z.string().url(), title: z.string(), text: z.string(), created_at: z.string().datetime(), locked: z.boolean(), deleted: z.boolean(), comments: z.array(z.object({ id: z.string(), text: z.string(), is_author: z.boolean() })), comments_partial: z.boolean() });
export type RedditSource = z.infer<typeof sourceSchema>;
export const analysisSchema = z.object({
  summary: z.string().max(1000), problem: z.enum(["crm_hygiene", "reporting", "handoffs", "integration", "manual_operations", "other"]),
  evidence: z.array(z.object({ source_id: z.string(), quote: z.string().min(8).max(600), supports: z.string().min(1).max(300) })).min(1).max(6),
  unknowns: z.array(z.string().max(200)).max(8), confidence: z.number().min(0).max(1),
  fit: z.number().int().min(0).max(30), help: z.number().int().min(0).max(25), business: z.number().int().min(0).max(15), opportunity: z.number().int().min(0).max(15),
  relevant: z.boolean(), rationale: z.string().max(1000), asset: z.string().max(600),
});
export type RedditAnalysis = z.infer<typeof analysisSchema>;
export const statuses = ["discovered", "reviewed", "engaged", "responded", "contact_shared", "qualified", "meeting", "dismissed"] as const;
export const draftSchema = z.object({ body: z.string().min(1).max(2000), approved: z.boolean(), critique: z.string().max(1500), asset_outline: z.string().max(2000) });
export const opportunitySchema = z.object({ id: z.string(), source: sourceSchema, analysis: analysisSchema.nullable(), query_ids: z.array(z.string()), status: z.enum(statuses), owner: z.enum(["josh", "suuchi"]).nullable(), watched: z.boolean(), followup_at: z.string().nullable(), notes: z.string(), contact: z.object({ email: z.string().email(), consent_evidence: z.string().min(10).max(1500) }).nullable(), draft: draftSchema.nullable(), feedback: z.enum(["relevant", "irrelevant"]).nullable(), changed_at: z.string().nullable(), checked_at: z.string(), created_at: z.string(), updated_at: z.string(), version: z.number().int() });
export type Opportunity = z.infer<typeof opportunitySchema>;
export const patchSchema = opportunitySchema.pick({ status: true, owner: true, watched: true, notes: true, contact: true, feedback: true }).partial().extend({ notes: z.string().max(4000).optional(), followup_at: z.string().datetime().nullable().optional(), version: z.number().int().positive() }).strict();

export function accessState(env: Record<string, string | undefined> = process.env) {
  const missing = ["REDDIT_COMMERCIAL_APPROVAL_REFERENCE", "REDDIT_USER_AGENT", "REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET", "REDDIT_REFRESH_TOKEN", "ANTHROPIC_API_KEY"].filter((key) => !env[key]?.trim());
  return { ready: missing.length === 0, missing };
}
export function checkedAnalysis(value: unknown, source: RedditSource): RedditAnalysis {
  const analysis = analysisSchema.parse(value);
  const texts = new Map<string, string>([[source.id, `${source.title}\n${source.text}`], ...source.comments.map((comment) => [comment.id, comment.text] as const)]);
  for (const evidence of analysis.evidence) if (!texts.get(evidence.source_id)?.includes(evidence.quote)) throw new Error("Analysis quoted evidence absent from the thread.");
  return analysis;
}
export function score(analysis: RedditAnalysis, source: RedditSource, now = Date.now()) {
  const hours = Math.max(0, (now - Date.parse(source.created_at)) / 3600000);
  const recency = hours <= 24 ? 15 : hours <= 48 ? 10 : hours <= 72 ? 5 : 0;
  return analysis.fit + analysis.help + analysis.business + recency + (source.locked || source.deleted ? 0 : analysis.opportunity);
}
export function responseAllowed(source: RedditSource, community: Community | undefined, now = Date.now()) {
  return !source.deleted && !source.locked && community?.response_policy === "helpful_only" && Boolean(community.rules.trim()) && community.rules_checked_at !== null && now - Date.parse(community.rules_checked_at) < 7 * 86400000;
}
export function clusters(rows: Opportunity[]) {
  const grouped = new Map<string, Opportunity[]>();
  for (const row of rows) if (row.analysis?.relevant && !row.source.deleted && row.status !== "dismissed" && row.feedback !== "irrelevant") {
    const list = grouped.get(row.analysis.problem) ?? [];
    if (!list.some((item) => item.id === row.id)) list.push(row);
    grouped.set(row.analysis.problem, list);
  }
  return [...grouped].map(([problem, threads]) => ({ problem, threads, count: threads.length })).filter((cluster) => cluster.count >= 2).sort((a, b) => b.count - a.count);
}
export function briefing(rows: Opportunity[], owner: "josh" | "suuchi", now = Date.now()) {
  const active = rows.filter((row) => !row.source.deleted && row.status !== "dismissed" && row.feedback !== "irrelevant");
  return {
    actToday: active.filter((row) => row.analysis?.relevant && row.analysis.confidence >= 0.7 && score(row.analysis, row.source, now) >= 60 && row.status === "discovered" && (!row.owner || row.owner === owner) && Date.parse(row.source.created_at) >= now - 72 * 3600000).sort((a, b) => score(b.analysis!, b.source, now) - score(a.analysis!, a.source, now)).slice(0, 5),
    followup: active.filter((row) => row.owner === owner && row.watched && ((row.followup_at && Date.parse(row.followup_at) <= now) || (row.changed_at && Date.parse(row.changed_at) > Date.parse(row.updated_at)))),
    buildNext: clusters(active).slice(0, 3),
  };
}
export function queryPlan(config: RedditConfig, rows: Opportunity[], day: number) {
  const enabled = config.queries.filter((query) => query.enabled);
  const stats = enabled.map((query) => {
    const reviewed = rows.filter((row) => row.query_ids.includes(query.id) && row.feedback);
    const relevant = reviewed.filter((row) => row.feedback === "relevant").length;
    const qualified = reviewed.filter((row) => ["qualified", "meeting"].includes(row.status)).length;
    return { ...query, reviewed: reviewed.length, relevant, qualified, priority: (relevant + qualified + 2) / (reviewed.length + 4) };
  });
  if (!stats.length) return [];
  const explore = stats[((day % stats.length) + stats.length) % stats.length];
  return [explore, ...stats.filter((query) => query.id !== explore.id).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))].slice(0, config.max_queries);
}
