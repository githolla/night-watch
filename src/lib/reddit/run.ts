import type { SupabaseClient } from "@supabase/supabase-js";
import { researchBudget, withBudget } from "../anthropic-cost.ts";
import { accessState, queryPlan, type RedditSource } from "./domain.ts";
import { RedditProvider } from "./provider.ts";
import { analyze } from "./analysis.ts";
import { check, loadConfig, loadOpportunities, purgeExpired } from "./store.ts";

export async function runReddit(db: SupabaseClient, key: string, now = Date.now()) {
  const config = await loadConfig(db);
  await purgeExpired(db, config, now);
  const stale = await db.from("reddit_opportunities").delete().lt("checked_at", new Date(now - 48 * 3600000).toISOString());
  check(stale.error);
  const access = accessState();
  const report = { queries: [] as Array<{ id: string; found: number; partial: boolean; error?: string }>, errors: [] as string[], found: 0, analyzed: 0, refreshed: 0, unprocessed: 0, requests: 0, cost_usd: 0, missing: access.missing };
  check((await db.from("reddit_runs").update({ status: "failed", finished_at: new Date(now).toISOString(), report: { errors: ["Run interrupted or timed out before recording a result."] } }).eq("status", "running").lt("started_at", new Date(now - 10 * 60000).toISOString())).error);
  const { data: claim, error } = await db.from("reddit_runs").insert({ run_key: key, status: "running" }).select("id").single();
  if (error?.code === "23505") return { alreadyRanOrBusy: true };
  check(error);
  if (!claim) throw new Error("Run claim could not be saved.");
  let status = "complete";
  const signal = AbortSignal.timeout(220000);
  const provider = new RedditProvider(signal);
  const budget = researchBudget(0, config.cost_cap_usd);
  const usage = withBudget((cost) => { report.cost_usd += cost; }, budget);
  try {
    if (!config.enabled || !access.ready) status = "disabled";
    else {
      const existing = await loadOpportunities(db);
      const communities = config.communities.filter((community) => community.enabled).map((community) => community.name);
      if (!communities.length) throw new Error("No communities enabled.");
      const candidates = new Map<string, { source: RedditSource; queries: Set<string> }>();
      const watched = existing.filter((row) => row.watched).sort((a, b) => a.checked_at.localeCompare(b.checked_at));
      if (watched.length > config.max_watches) report.errors.push(`${watched.length - config.max_watches} watched threads deferred by the refresh limit.`);
      for (const row of watched.slice(0, config.max_watches)) {
        try {
          const source = await provider.thread(row.id);
          if (source.deleted) { check((await db.from("reddit_opportunities").delete().eq("id", row.id)).error); continue; }
          const changed = JSON.stringify(source) !== JSON.stringify(row.source);
          const write = await db.from("reddit_opportunities").update({ source, version: row.version + 1, checked_at: new Date(now).toISOString(), ...(changed ? { analysis: null, draft: null, changed_at: new Date(now).toISOString() } : {}) }).eq("id", row.id).eq("version", row.version);
          check(write.error);
          if (changed || !row.analysis) candidates.set(row.id, { source, queries: new Set(row.query_ids) });
          report.refreshed++;
        } catch { report.errors.push(`Could not refresh watched thread ${row.id}; its saved evidence was removed.`); check((await db.from("reddit_opportunities").delete().eq("id", row.id)).error); }
      }
      for (const query of queryPlan(config, existing, Math.floor(now / 86400000))) {
        try {
          const result = await provider.search(query.query, communities, now - 72 * 3600000);
          report.queries.push({ id: query.id, found: result.rows.length, partial: result.partial });
          for (const source of result.rows) {
            const old = existing.find((row) => row.id === source.id);
            if (old?.analysis && Date.parse(old.checked_at) > now - 20 * 3600000) continue;
            const entry = candidates.get(source.id) ?? { source, queries: new Set(old?.query_ids ?? []) };
            entry.queries.add(query.id); candidates.set(source.id, entry);
          }
        } catch (error) { report.queries.push({ id: query.id, found: 0, partial: true, error: error instanceof Error ? error.message : "Search failed." }); }
      }
      report.found = candidates.size;
      const selected = [...candidates.values()].sort((a, b) => Number(watched.some((row) => row.id === b.source.id)) - Number(watched.some((row) => row.id === a.source.id)) || Date.parse(b.source.created_at) - Date.parse(a.source.created_at)).slice(0, config.max_threads);
      report.unprocessed = candidates.size - selected.length;
      for (const entry of selected) {
        if (signal.aborted || budget.spentUsd >= budget.costCapUsd) { report.unprocessed++; continue; }
        try {
          const source = await provider.thread(entry.source.id);
          if (source.deleted) { check((await db.from("reddit_opportunities").delete().eq("id", source.id)).error); continue; }
          const analysis = await analyze(source, signal, usage);
          const current = await db.from("reddit_opportunities").select("source,version").eq("id", source.id).maybeSingle();
          check(current.error);
          const changed = current.data && JSON.stringify(current.data.source) !== JSON.stringify(source);
          const values = { source, analysis, query_ids: [...entry.queries], checked_at: new Date(now).toISOString(), ...(changed ? { draft: null, changed_at: new Date(now).toISOString() } : {}) };
          if (current.data) check((await db.from("reddit_opportunities").update({ ...values, version: current.data.version + 1 }).eq("id", source.id).eq("version", current.data.version)).error);
          else check((await db.from("reddit_opportunities").insert({ id: source.id, ...values })).error);
          report.analyzed++;
          if (source.comments_partial) report.errors.push(`Thread ${source.id}: comments are a bounded sample, not full coverage.`);
        } catch (error) { report.errors.push(`Thread ${entry.source.id}: ${error instanceof Error ? error.message : "Analysis failed."}`); }
      }
      if (report.unprocessed || report.errors.length || report.queries.some((query) => query.partial)) status = "partial";
    }
  } catch (error) { status = "failed"; report.errors.push(error instanceof Error ? error.message : "Discovery failed."); }
  report.requests = provider.requests;
  const finish = await db.from("reddit_runs").update({ status, finished_at: new Date().toISOString(), report }).eq("id", claim.id);
  check(finish.error);
  return { id: claim.id, status, report };
}
