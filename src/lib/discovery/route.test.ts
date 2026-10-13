import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import * as domain from "./domain.ts";
import * as store from "./store.ts";
import { queryDb } from "../testing/query-db.ts";
import { opportunity } from "./fixtures.ts";
function handler({ role = "member", row = opportunity(), usable = true, authenticated = true }: { role?: string; row?: domain.DiscoveryOpportunity; usable?: boolean; authenticated?: boolean } = {}) {
  let queued = 0; let started = 0;
  const memory = queryDb({ discovery_opportunities: [row] }, { review_discovery: (args, tables) => { const target = tables.discovery_opportunities.find((row) => row.id === args.p_id && row.version === args.p_version); if (!target) return false; Object.assign(target, args.p_patch, { version: Number(target.version) + 1 }); return true; }, queue_discovery_company: () => { queued++; return "candidate"; } });
  const user = { role, owner: "josh", email: "josh@example.com" };
  const exports: { POST?: (request: Request) => Promise<Response> } = {};
  const mocks: Record<string, unknown> = { "node:crypto": { randomUUID: () => "manual" }, zod: { z }, "@/lib/auth": { requireUser: async () => { if (!authenticated) throw new Error("Unauthorized"); return user; }, requireActualUser: async () => user }, "@/lib/supabase/admin": { admin: () => memory.db }, "@/lib/discovery/domain": domain, "@/lib/discovery/store": store, "@/lib/discovery/run": { runDiscovery: async () => { started++; return { status: "complete" }; } }, "@/lib/nightly-list-builder": { screenDomains: async () => [{ usable, reason: usable ? null : "do-not-contact or already known" }] } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../app/api/discovery/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, Date, Error, require: (name: string) => mocks[name] });
  return { post: (body: unknown) => exports.POST!(new Request("https://app.test/api/discovery", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })), memory, queued: () => queued, started: () => started, id: row.id };
}
test("authentication and admin role protect spending and research promotion", async () => {
  assert.equal((await handler({ authenticated: false }).post({ action: "run" })).status, 401);
  const h = handler(); assert.equal((await h.post({ action: "run" })).status, 403); assert.equal(h.started(), 0);
  assert.equal((await h.post({ action: "queue", id: h.id, version: 1 })).status, 403); assert.equal(h.queued(), 0);
});
test("raw discoveries cannot enter company research without business confirmation and ownership", async () => {
  const h = handler({ role: "admin" }); assert.equal((await h.post({ action: "queue", id: h.id, version: 1 })).status, 400); assert.equal(h.queued(), 0);
});
test("excluded companies stay excluded at discovery promotion", async () => {
  const h = handler({ role: "admin", row: opportunity({ company_confirmed: true, owner: "josh" }), usable: false });
  assert.equal((await h.post({ action: "queue", id: h.id, version: 1 })).status, 409); assert.equal(h.queued(), 0);
});
test("confirmed companies queue for research without creating contacts, addresses or sends", async () => {
  const h = handler({ role: "admin", row: opportunity({ company_confirmed: true, owner: "josh" }) });
  assert.equal((await h.post({ action: "queue", id: h.id, version: 1 })).status, 200); assert.equal(h.queued(), 1);
  assert.equal(h.memory.log.some((entry) => ["people", "cards", "touches"].includes(entry.table)), false);
});
test("a stale update and another seat's review cannot overwrite a current conversation", async () => {
  const stale = handler({ row: opportunity({ version: 2 }) }); assert.equal((await stale.post({ action: "update", id: stale.id, patch: { version: 1, notes: "overwrite" } })).status, 409);
  const other = handler({ row: opportunity({ owner: "suuchi" }) }); assert.equal((await other.post({ action: "update", id: other.id, patch: { version: 1, notes: "overwrite" } })).status, 403);
});
test("company identity edits revoke confirmation unless explicitly reconfirmed", async () => {
  const h = handler({ row: opportunity({ company_confirmed: true }) });
  assert.equal((await h.post({ action: "update", id: h.id, patch: { version: 1, company_domain: "other.com" } })).status, 200);
  assert.equal(h.memory.tables.discovery_opportunities[0].company_confirmed, false);
});
test("queued business identities cannot be silently changed and research stage cannot be forged", async () => {
  const h = handler({ row: opportunity({ promoted_candidate_id: "candidate" }) });
  assert.equal((await h.post({ action: "update", id: h.id, patch: { version: 1, company_domain: "other.com" } })).status, 409);
  assert.equal((await handler().post({ action: "update", id: h.id, patch: { version: 1, status: "research_queued" } })).status, 400);
});
test("queued opportunities still allow notes and follow-up updates", async () => {
  const h = handler({ row: opportunity({ promoted_candidate_id: "candidate", status: "research_queued", owner: "josh" }) });
  assert.equal((await h.post({ action: "update", id: h.id, patch: { version: 1, status: "research_queued", notes: "Follow up after buyer research" } })).status, 200);
  assert.equal(h.memory.tables.discovery_opportunities[0].notes, "Follow up after buyer research");
});
