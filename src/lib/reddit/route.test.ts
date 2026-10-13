import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as domain from "./domain.ts";
import * as store from "./store.ts";
import * as cost from "../anthropic-cost.ts";
import { queryDb } from "../testing/query-db.ts";
import { opportunity } from "./fixtures.ts";
function handler({ role = "member", authenticated = true, row = opportunity() }: { role?: string; authenticated?: boolean; row?: domain.Opportunity } = {}) {
  const user = { owner: "josh", role, email: "josh@example.com" };
  const memory = queryDb({ reddit_opportunities: [row] }, { update_reddit_opportunity: (args, tables) => { const target = tables.reddit_opportunities.find((item) => item.id === args.p_id && item.version === args.p_version); if (!target) return false; Object.assign(target, args.p_patch, { version: Number(target.version) + 1 }); return true; } });
  let spendingCalls = 0;
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const mocks: Record<string, unknown> = { "node:crypto": { randomUUID: () => "manual-key" }, zod: { z }, "@/lib/auth": { requireUser: async () => { if (!authenticated) throw new Error("Unauthorized"); return user; }, requireActualUser: async () => user }, "@/lib/supabase/admin": { admin: () => memory.db }, "@/lib/reddit/domain": domain, "@/lib/reddit/store": store, "@/lib/reddit/run": { runReddit: async () => { spendingCalls++; return { status: "complete" }; } }, "@/lib/reddit/provider": {}, "@/lib/reddit/analysis": {}, "@/lib/anthropic-cost": cost };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../app/api/reddit/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, Date, Error, Set, AbortSignal, require: (name: string) => mocks[name] });
  return { post: (body: unknown) => exports.POST!(new Request("https://app.test/api/reddit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })), memory, spendingCalls: () => spendingCalls };
}
test("anonymous users cannot edit and members cannot spend discovery budget", async () => {
  assert.equal((await handler({ authenticated: false }).post({ action: "run" })).status, 401);
  const h = handler(); assert.equal((await h.post({ action: "run" })).status, 403); assert.equal(h.spendingCalls(), 0);
});
test("a stale review cannot overwrite another person's update", async () => {
  const h = handler({ row: opportunity({ version: 2 }) });
  assert.equal((await h.post({ action: "update", id: "abc", patch: { version: 1, notes: "Overwrite" } })).status, 409);
  assert.equal(h.memory.tables.reddit_opportunities[0].notes, "");
});
test("members cannot claim another seat's thread or reassign a thread to another seat", async () => {
  assert.equal((await handler({ row: opportunity({ owner: "suuchi" }) }).post({ action: "update", id: "abc", patch: { version: 1, notes: "Take over" } })).status, 403);
  assert.equal((await handler().post({ action: "update", id: "abc", patch: { version: 1, owner: "suuchi" } })).status, 403);
});
test("engagement requires an owner and contact-shared requires voluntary contact evidence", async () => {
  assert.equal((await handler().post({ action: "update", id: "abc", patch: { version: 1, status: "engaged" } })).status, 400);
  assert.equal((await handler().post({ action: "update", id: "abc", patch: { version: 1, owner: "josh", status: "contact_shared" } })).status, 400);
  const h = handler();
  assert.equal((await h.post({ action: "update", id: "abc", patch: { version: 1, owner: "josh", status: "contact_shared", contact: { email: "shared@example.com", consent_evidence: "They supplied this address and requested a business follow-up in our conversation." } } })).status, 200);
  assert.equal(h.memory.tables.reddit_opportunities[0].status, "contact_shared");
  assert.equal(h.spendingCalls(), 0);
});
test("invalid and unknown patch fields are rejected", async () => {
  assert.equal((await handler().post({ action: "update", id: "abc", patch: { version: 1, email_guess: "inferred@example.com" } })).status, 400);
});
