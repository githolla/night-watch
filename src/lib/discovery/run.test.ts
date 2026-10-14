import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as domain from "./domain.ts";
import * as store from "./store.ts";
import * as cost from "../anthropic-cost.ts";
import { itemId } from "./identity.ts";
import { queryDb } from "../testing/query-db.ts";
import { item, assessment, now, opportunity } from "./fixtures.ts";
import { assessCompanySignal } from "./company-signals.ts";
function runner(options: { configured?: boolean; changed?: boolean; failed?: boolean; empty?: boolean; expensive?: boolean } = {}) {
  let calls = 0;
  class Collector {
    requests = 0;
    async collect(source: domain.SourceConfig) { this.requests++; return { items: options.empty || options.failed ? [] : [{ ...item, source_id: source.id, ...(options.changed ? { text: `${item.text} Daily reporting is also needed.` } : {}) }], coverage: { source_id: source.id, state: options.failed ? "failed" : "complete", found: options.empty || options.failed ? 0 : 1, detail: options.failed ? "API unavailable" : "" } }; }
  }
  const exports: { runDiscovery?: (db: SupabaseClient, key: string, now: number) => Promise<{ status: string; report: { analyzed: number; saved: number; analysis_deferred: number; cost_usd: number } }> } = {};
  const addedMocks = { "./watchlist.ts": { knownTargetSites: async () => [] }, "./company-signals.ts": { assessCompanySignal } };
  const mocks: Record<string, unknown> = { "../anthropic-cost.ts": cost, "./domain.ts": domain, "./identity.ts": { itemId }, "./providers.ts": { DiscoveryCollector: Collector }, "./analyze.ts": { assess: async (_item: unknown, _signal: unknown, usage: cost.UsageRecorder) => { calls++; const amount = options.expensive ? 4 : 0.03; usage(amount); if (usage.budget) usage.budget.spentUsd += amount; return assessment; } }, "./store.ts": { ...store, loadOpportunities: async (db: SupabaseClient) => { const { data, error } = await db.from("discovery_opportunities").select("*"); store.check(error); return (data ?? []).map((row) => domain.opportunitySchema.parse({ ...opportunity(), assessment: null, ...row })); } } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./run.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, process: { env: { ANTHROPIC_API_KEY: options.configured === false ? "" : "test-key" } }, Date, Map, Set, Error, AbortSignal, require: (name: string) => ({ ...mocks, ...addedMocks })[name] });
  return { run: exports.runDiscovery!, calls: () => calls };
}
function database(rows: domain.DiscoveryOpportunity[] = [], enabled = true) { return queryDb({ discovery_config: [{ id: true, config: { ...domain.defaultConfig, enabled, max_sources: 2, sources: domain.defaultConfig.sources.slice(0, 2) } }], discovery_opportunities: rows, accounts: [] }); }
test("raw discoveries persist without a model key and analysis is explicitly deferred", async () => {
  const h = runner({ configured: false }); const memory = database(); const result = await h.run(memory.db, "nightly:today", now);
  assert.equal(result.status, "partial"); assert.equal(result.report.saved, 1); assert.equal(result.report.analysis_deferred, 1); assert.equal(h.calls(), 0);
  assert.equal(memory.tables.discovery_opportunities.length, 1); assert.equal((memory.tables.discovery_opportunities[0].source_ids as string[]).length, 2);
});
test("overlapping collectors deduplicate evidence and measure model cost", async () => {
  const h = runner(); const memory = database(); const result = await h.run(memory.db, "nightly:today", now);
  assert.equal(result.status, "complete", JSON.stringify(result)); assert.equal(result.report.analyzed, 1); assert.equal(result.report.cost_usd, 0.03); assert.equal(h.calls(), 1);
});
test("changed source evidence invalidates assessment but preserves human review fields", async () => {
  const row = opportunity({ owner: "suuchi", status: "engaged", company_confirmed: true, notes: "Already contacted manually" });
  const h = runner({ changed: true, configured: false }); const memory = database([row]); await h.run(memory.db, "nightly:today", now);
  const saved = memory.tables.discovery_opportunities[0]; assert.equal(saved.assessment, null); assert.equal(saved.owner, "suuchi"); assert.equal(saved.notes, row.notes); assert.equal(saved.status, "engaged"); assert.equal(saved.company_confirmed, true); assert.ok(Number(saved.version) > 1);
});
test("failed collectors produce partial coverage while retaining existing reviewed evidence", async () => {
  const memory = database([opportunity()]); const result = await runner({ failed: true }).run(memory.db, "nightly:today", now);
  assert.equal(result.status, "failed"); assert.equal(memory.tables.discovery_opportunities.length, 1); assert.equal(result.report.analyzed, 0);
});
test("closed jobs are marked inactive only when the complete board no longer contains them", async () => {
  const memory = database([opportunity()]); memory.tables.discovery_config[0].config = { ...domain.defaultConfig, sources: [{ id: item.source_id, provider: "greenhouse", label: "Acme", value: "acme", company: "Acme", domain: "acme.com", enabled: true, permission_reference: "Public job-board API" }] };
  await runner({ empty: true }).run(memory.db, "nightly:today", now);
  assert.equal((memory.tables.discovery_opportunities[0].item as domain.DiscoveryItem).active, false); assert.equal(memory.tables.discovery_opportunities[0].assessment, null);
});
test("paused runs still purge expired sources and stale discussions without model calls", async () => {
  const memory = database([opportunity({ created_at: new Date(now - 31 * 86400000).toISOString() }), opportunity({ id: "discussion", item: { ...item, provider: "hacker_news" }, checked_at: new Date(now - 4 * 86400000).toISOString() })], false);
  const h = runner(); assert.equal((await h.run(memory.db, "nightly:today", now)).status, "disabled"); assert.equal(memory.tables.discovery_opportunities.length, 0); assert.equal(h.calls(), 0);
});
test("a failed claim or report write is not disguised as successful research", async () => {
  const memory = database(); memory.fail("discovery_runs", "insert"); await assert.rejects(runner().run(memory.db, "nightly:today", now), /Injected failure/);
});
