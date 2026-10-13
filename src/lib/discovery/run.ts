import type { SupabaseClient } from "@supabase/supabase-js";
import { researchBudget, withBudget } from "../anthropic-cost.ts";
import { sourcePlan, sourceConfigSchema, type SourceConfig, type DiscoveryItem } from "./domain.ts";
import { DiscoveryCollector, type Coverage } from "./providers.ts";
import { assess } from "./analyze.ts";
import { itemId } from "./identity.ts";
import { check, loadConfig, loadOpportunities } from "./store.ts";

export async function knownBoards(db: SupabaseClient): Promise<SourceConfig[]> {
  const { data, error } = await db.from("accounts").select("id,name,domain,ats_provider,ats_ref").eq("status", "active").in("ats_provider", ["greenhouse", "lever"]).order("careers_checked_at", { ascending: true, nullsFirst: true }).limit(200);
  check(error);
  return (data ?? []).flatMap((row) => { const parsed = sourceConfigSchema.safeParse({ id: `board_${row.id}`, provider: row.ats_provider, label: `${row.name} careers`, value: row.ats_ref, company: row.name, domain: row.domain, enabled: true, permission_reference: "Public job-board API; board identity previously discovered for this account" }); return parsed.success ? [parsed.data] : []; });
}
export async function runDiscovery(db: SupabaseClient, key: string, now = Date.now()) {
  const config = await loadConfig(db);
  check((await db.from("discovery_opportunities").delete().lt("created_at", new Date(now - config.retention_days * 86400000).toISOString())).error);
  check((await db.from("discovery_opportunities").delete().contains("item", { provider: "hacker_news" }).lt("checked_at", new Date(now - 72 * 3600000).toISOString())).error);
  check((await db.from("discovery_runs").update({ status: "failed", finished_at: new Date(now).toISOString(), report: { errors: ["Run interrupted before final report."] } }).eq("status", "running").lt("started_at", new Date(now - 10 * 60000).toISOString())).error);
  const claim = await db.from("discovery_runs").insert({ run_key: key, status: "running" }).select("id").single();
  if (claim.error?.code === "23505") return { alreadyRanOrBusy: true };
  check(claim.error); if (!claim.data) throw new Error("Could not claim discovery run.");
  const report = { sources: [] as Coverage[], errors: [] as string[], found: 0, saved: 0, analyzed: 0, analysis_deferred: 0, sources_deferred: 0, requests: 0, cost_usd: 0, analysis_configured: Boolean(process.env.ANTHROPIC_API_KEY) };
  let status = config.enabled ? "complete" : "disabled";
  const signal = AbortSignal.timeout(220000);
  const collector = new DiscoveryCollector(signal);
  const budget = researchBudget(0, config.cost_cap_usd);
  const usage = withBudget((cost) => { report.cost_usd += cost; }, budget);
  try {
    if (config.enabled) {
      const existing = await loadOpportunities(db);
      const boards = await knownBoards(db).catch(() => { report.errors.push("Existing company job-board inventory could not be loaded."); return []; });
      const configuredBoards = new Set(config.sources.filter((source) => ["greenhouse", "lever"].includes(source.provider)).map((source) => `${source.provider}:${source.value}`));
      const autoBoards = boards.filter((source) => !configuredBoards.has(`${source.provider}:${source.value}`));
      const configuredSlots = Math.min(config.sources.filter((source) => source.enabled).length, config.max_sources);
      const plan = sourcePlan({ ...config, max_sources: Math.max(1, configuredSlots) }, existing, Math.floor(now / 86400000));
      const boardSlots = config.max_sources - plan.length;
      const offset = autoBoards.length ? (Math.floor(now / 86400000) * Math.max(1, boardSlots)) % autoBoards.length : 0;
      for (let index = 0; index < Math.min(boardSlots, autoBoards.length); index++) plan.push({ ...autoBoards[(offset + index) % autoBoards.length], reviewed: 0, relevant: 0, qualified: 0, priority: 0.5 });
      report.sources_deferred = config.sources.filter((source) => source.enabled).length + autoBoards.length - plan.length;
      if (!plan.length) report.errors.push("No enabled sources or known public job boards.");
      const candidates = new Map<string, { item: DiscoveryItem; sourceIds: Set<string> }>();
      for (const source of plan) {
        const result = await collector.collect(source, config.max_items, now, config.keywords);
        report.sources.push(result.coverage);
        if (["greenhouse", "lever"].includes(source.provider) && result.coverage.state === "complete") {
          const seen = new Set(result.items.map(itemId));
          for (const old of existing.filter((row) => row.item.kind === "hiring" && row.item.source_id === source.id && row.item.active && !seen.has(row.id))) {
            check((await db.from("discovery_opportunities").update({ item: { ...old.item, active: false }, assessment: null, version: old.version + 1, checked_at: new Date(now).toISOString() }).eq("id", old.id).eq("version", old.version)).error);
          }
        }
        for (const item of result.items) {
          const id = itemId(item);
          const entry = candidates.get(id);
          if (entry) { entry.sourceIds.add(source.id); if (entry.item.partial && !item.partial) entry.item = item; }
          else candidates.set(id, { item, sourceIds: new Set([source.id]) });
        }
      }
      report.found = candidates.size;
      for (const [id, candidate] of candidates) {
        const old = existing.find((row) => row.id === id);
        const changed = old && (old.item.title !== candidate.item.title || old.item.text !== candidate.item.text || old.item.active !== candidate.item.active || old.item.deadline !== candidate.item.deadline);
        const values = { item: candidate.item, source_ids: [...new Set([...(old?.source_ids ?? []), ...candidate.sourceIds])], checked_at: new Date(now).toISOString(), ...(changed ? { assessment: null } : {}) };
        const write = old ? await db.from("discovery_opportunities").update({ ...values, version: old.version + 1 }).eq("id", id).eq("version", old.version).select("id") : await db.from("discovery_opportunities").insert({ id, ...values, version: 1, assessment: null, company_name: candidate.item.company, company_domain: candidate.item.domain, company_evidence_url: candidate.item.company && candidate.item.domain ? candidate.item.url : null }).select("id");
        if (write.error) { report.errors.push(`Could not save discovery ${id.slice(0, 12)}.`); continue; }
        if (!write.data?.length) { report.errors.push(`Discovery ${id.slice(0, 12)} changed during collection; refresh deferred.`); continue; }
        report.saved++;
      }
      const pending = (await loadOpportunities(db)).filter((row) => !row.assessment && row.status !== "dismissed" && row.item.active).sort((a, b) => Number(b.item.kind === "buying_request") - Number(a.item.kind === "buying_request") || Number(a.item.partial) - Number(b.item.partial) || a.created_at.localeCompare(b.created_at));
      for (const row of pending.slice(0, config.max_analysis)) {
        if (!report.analysis_configured || signal.aborted || budget.spentUsd >= budget.costCapUsd) continue;
        try {
          const assessment = await assess(row.item, signal, usage);
          const write = await db.from("discovery_opportunities").update({ assessment, version: row.version + 1 }).eq("id", row.id).eq("version", row.version).select("id");
          check(write.error); if (write.data?.length) report.analyzed++; else report.errors.push("A reviewed item changed while analysis was running; assessment was not saved.");
        } catch { report.errors.push(`Analysis failed for ${row.id.slice(0, 12)}; source remains in the review queue.`); }
      }
      report.analysis_deferred = pending.length - report.analyzed;
      if (report.errors.length || report.analysis_deferred || report.sources_deferred || report.sources.some((source) => source.state !== "complete")) status = "partial";
      if (!report.sources.some((source) => source.state === "complete" || source.state === "partial")) status = "failed";
    }
  } catch { status = "failed"; report.errors.push("Discovery could not finish. Check database configuration and source coverage."); }
  report.requests = collector.requests;
  check((await db.from("discovery_runs").update({ status, finished_at: new Date().toISOString(), report }).eq("id", claim.data.id)).error);
  return { id: claim.data.id, status, report };
}
