import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { queryDb } from "./testing/query-db.ts";
function route(role: string) {
  const { db } = queryDb({ cadence_steps: [] }); const owners: string[] = [];
  const mocks: Record<string, unknown> = { "@/lib/auth": { requireUser: async () => ({ role, owner: "josh" }) }, "@/lib/supabase/admin": { admin: () => db }, "@/lib/focus-data": { focusForOwner: (owner: string) => Array.from({ length: owner === "suuchi" ? 19 : 27 }, (_, i) => ({ domain: `${i}.test` })) }, "@/lib/nightly-lists": { loadNightlyLists: async () => {} }, "@/lib/send-plan-loader": { loadSendPlan: async (_db: unknown, owner: string) => { owners.push(owner); return { going: owner === "suuchi" ? 0 : 1, blocker: null }; } }, "@/lib/replies-view": { waitingReplyCount: async () => 0 }, "@/lib/draft-summary": { seatSummary: async () => ({ unsent: 20 }) }, "@/lib/call-tasks": { loadCallTasks: async () => [] }, "@/lib/linkedin-tasks": { linkedinTaskCount: async () => 0 } };
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/nav-counts/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, URL, Date, Set, Response, require: (name: string) => mocks[name] });
  return { get: exports.GET!, owners };
}
test("sidebar separates researched company counts from actual send slots by selected seat", async () => { const h = route("admin"); const result = await (await h.get(new Request("https://app.test/api/nav-counts?owner=suuchi"))).json(); assert.equal(result.companies, 19); assert.equal(result.queued, 0); assert.deepEqual(h.owners, ["suuchi"]); });
test("non-admin sidebar counts cannot switch to another seat", async () => { const h = route("member"); const result = await (await h.get(new Request("https://app.test/api/nav-counts?owner=suuchi"))).json(); assert.equal(result.companies, 27); assert.equal(result.queued, 1); assert.deepEqual(h.owners, ["josh"]); });
