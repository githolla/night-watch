import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { newCallPlan, dialHref, phoneEvidence, type CallPlan } from "./call-plan.ts";
function harness(owner = "josh", role = "member", hasPhone = true) {
  let plan = newCallPlan("2026-10-14T14:00:00Z");
  if (hasPhone) plan.phone = { number: "8005551234", kind: "company", sourceUrl: "https://acme.test/contact", checkedAt: "2026-10-14T14:00:00Z", notes: "Main line" };
  const events: string[] = [];
  const mocks: Record<string, unknown> = {
    zod: { z }, "@/lib/auth": { requireUser: async () => ({ owner, role }) }, "@/lib/supabase/admin": { admin: () => ({}) },
    "@/lib/call-plan": { dialHref, phoneEvidence },
    "@/lib/email-suppression": { optOutPerson: async () => { events.push("optout"); } },
    "@/lib/call-tasks": { loadCallTasks: async () => [{ id: "task", personId: "person", owner: "josh", plan }], updateCallPlan: async (_db: unknown, _id: string, change: (plan: CallPlan) => CallPlan) => { plan = change(plan); events.push("saved"); return plan; } },
  };
  const exports: { PATCH?: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/calls/[id]/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Response, Date, require: (name: string) => mocks[name] });
  return { events, request: (body: unknown) => exports.PATCH!(new Request("https://app.test/api/calls/task", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "task" }) }) };
}
test("shared viewing never attributes a completed call to another sender", async () => {
  const h = harness("suuchi", "admin");
  assert.equal((await h.request({ action: "complete", outcome: "connected" })).status, 403);
  assert.deepEqual(h.events, []);
});
test("call completion requires an actual phone number", async () => {
  const h = harness("josh", "member", false);
  assert.equal((await h.request({ action: "complete", outcome: "voicemail" })).status, 400);
  assert.deepEqual(h.events, []);
});
test("not interested records the call and applies the existing opt-out guard", async () => {
  const h = harness();
  assert.equal((await h.request({ action: "complete", outcome: "not_interested", notes: "Asked to stop" })).status, 200);
  assert.deepEqual(h.events, ["saved", "optout"]);
});
test("phone edits require a public source and reject unsafe links", async () => {
  const h = harness();
  assert.equal((await h.request({ action: "edit", phone: { number: "8005551234", kind: "direct", sourceUrl: "javascript:alert(1)", checkedAt: new Date().toISOString() } })).status, 400);
  assert.deepEqual(h.events, []);
});
