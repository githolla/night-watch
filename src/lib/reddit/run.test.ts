import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as domain from "./domain.ts";
import * as store from "./store.ts";
import * as cost from "../anthropic-cost.ts";
import { queryDb } from "../testing/query-db.ts";
import { source, analysis, now, opportunity } from "./fixtures.ts";

type Options = { approved?: boolean; failSearch?: boolean; changed?: boolean; deleted?: boolean; analysisFails?: boolean; expensive?: boolean };
function runner(options: Options = {}) {
  let reads = 0; let modelCalls = 0;
  class Provider {
    requests = 0;
    async search() { this.requests++; reads++; if (options.failSearch) throw new Error("Reddit read failed (429)"); return { rows: [source], partial: false }; }
    async thread() { this.requests++; reads++; return { ...source, deleted: options.deleted ?? false, ...(options.changed ? { text: `${source.text} We also need daily reporting.` } : {}) }; }
  }
  const exports: { runReddit?: (db: SupabaseClient, key: string, now: number) => Promise<{ status: string; report: { analyzed: number; errors: string[]; cost_usd: number } }> } = {};
  const mocks: Record<string, unknown> = {
    "../anthropic-cost.ts": cost,
    "./domain.ts": { ...domain, accessState: () => ({ ready: options.approved ?? true, missing: [] }) },
    "./provider.ts": { RedditProvider: Provider },
    "./analysis.ts": { analyze: async (_source: unknown, _signal: unknown, usage: cost.UsageRecorder) => { modelCalls++; if (options.analysisFails) throw new Error("Untrusted fabricated quote"); const amount = options.expensive ? 4 : 0.04; if (usage.budget) usage.budget.spentUsd += amount; usage(amount); return analysis; } },
    "./store.ts": store,
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./run.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Map, Set, JSON, Error, AbortSignal, require: (name: string) => mocks[name] });
  return { run: exports.runReddit!, reads: () => reads, modelCalls: () => modelCalls };
}
function database(rows: domain.Opportunity[] = [], enabled = true) {
  return queryDb({ reddit_config: [{ id: true, config: { ...domain.defaultConfig, enabled, max_queries: 2 } }], reddit_opportunities: rows });
}
test("disabled or unapproved runs record an honest disabled state with no API or model calls", async () => {
  for (const approved of [true, false]) {
    const h = runner({ approved }); const memory = database([], !approved);
    const result = await h.run(memory.db, "nightly:today", now);
    assert.equal(result.status, "disabled"); assert.equal(h.reads(), 0); assert.equal(h.modelCalls(), 0);
    assert.equal(memory.tables.reddit_runs[0].status, "disabled");
  }
});
test("overlapping query results are deduplicated and query provenance is preserved", async () => {
  const h = runner(); const memory = database();
  const result = await h.run(memory.db, "nightly:today", now);
  assert.equal(result.status, "complete", JSON.stringify(result)); assert.equal(result.report.analyzed, 1); assert.equal(h.modelCalls(), 1);
  assert.equal(memory.tables.reddit_opportunities.length, 1);
  assert.equal((memory.tables.reddit_opportunities[0].query_ids as string[]).length, 2);
  assert.equal(result.report.cost_usd, 0.04);
});
test("API failures produce partial coverage rather than an empty success", async () => {
  const h = runner({ failSearch: true }); const memory = database();
  const result = await h.run(memory.db, "nightly:today", now);
  assert.equal(result.status, "partial"); assert.equal(h.modelCalls(), 0);
});
test("changed watched threads invalidate drafts while preserving human notes, ownership and stage", async () => {
  const row = opportunity({ owner: "suuchi", status: "engaged", notes: "Already replied manually", watched: true, draft: { body: "Old draft", approved: true, critique: "Passed", asset_outline: "" } });
  const h = runner({ changed: true }); const memory = database([row]);
  await h.run(memory.db, "nightly:today", now);
  const saved = memory.tables.reddit_opportunities[0];
  assert.equal(saved.owner, "suuchi"); assert.equal(saved.status, "engaged"); assert.equal(saved.notes, row.notes);
  assert.equal(saved.draft, null); assert.ok(saved.changed_at); assert.ok(Number(saved.version) > 1);
});
test("removed watched threads are deleted rather than retained for lead follow-ups", async () => {
  const memory = database([opportunity({ watched: true })]);
  await runner({ deleted: true }).run(memory.db, "nightly:today", now);
  assert.equal(memory.tables.reddit_opportunities.length, 0);
});
test("failed evidence analysis never creates an opportunity", async () => {
  const memory = database(); const result = await runner({ analysisFails: true }).run(memory.db, "nightly:today", now);
  assert.equal(result.status, "partial"); assert.equal(memory.tables.reddit_opportunities.length, 0);
  assert.match(result.report.errors[0], /fabricated/);
});
test("old content is purged even while collection is disabled", async () => {
  const memory = database([opportunity({ checked_at: new Date(now - 49 * 3600000).toISOString() }), opportunity({ id: "expired", created_at: new Date(now - 8 * 86400000).toISOString() })], false);
  await runner().run(memory.db, "nightly:today", now);
  assert.equal(memory.tables.reddit_opportunities.length, 0);
});
test("a failed run-report write is surfaced rather than reported as complete", async () => {
  const memory = database(); memory.fail("reddit_runs", "insert");
  await assert.rejects(runner().run(memory.db, "nightly:today", now), /Injected failure/);
});
