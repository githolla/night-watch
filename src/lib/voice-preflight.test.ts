import test from "node:test";
import assert from "node:assert/strict";
import { voiceFailureDisposition } from "./voice-preflight.ts";

test("a Gmail or eligibility failure before provider creation holds only the contact", () => {
  assert.equal(voiceFailureDisposition(false), "contact_only");
});
test("every failure after a provider request begins retains the reconciliation hold", () => {
  assert.equal(voiceFailureDisposition(true), "reconcile_provider");
});

import { createClient } from "@supabase/supabase-js";
import { holdVoicePreflight } from "./voice-preflight.ts";

test("undialed failures release the global reservation while retaining contact review and audit", async () => {
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
  const db = createClient("https://example.supabase.co", "test", { auth: { persistSession: false }, global: { fetch: async (input, init) => {
    const method = init?.method ?? "GET";
    requests.push({ method, url: String(input), body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null });
    return Response.json(method === "PATCH" ? [{ id: "attempt" }] : { dispatched_at: "2026-11-02T17:00:00Z", context_snapshot: { company_name: "Example" } });
  } } });
  await holdVoicePreflight(db, "attempt", "Unable to refresh Gmail access");
  const patch = requests.find(request => request.method === "PATCH");
  assert.equal(patch?.body?.dispatched_at, null);
  assert.equal(patch?.body?.status, "held");
  assert.equal(patch?.body?.review_required, true);
  assert.match(patch?.url ?? "", /vapi_call_id=is.null/);
  const context = patch?.body?.context_snapshot as Record<string, unknown>;
  assert.equal(context.company_name, "Example");
  assert.equal(context.dispatch_enabled, false);
  assert.deepEqual(context.preflight_failure && (context.preflight_failure as Record<string, unknown>).reserved_at, "2026-11-02T17:00:00Z");
});
test("a changed or linked reservation cannot be cleared as an undialed failure", async () => {
  let patches = 0;
  const db = createClient("https://example.supabase.co", "test", { auth: { persistSession: false }, global: { fetch: async (_input, init) => {
    if (init?.method === "PATCH") patches++;
    return Response.json({ message: "No unlinked creating row" }, { status: 406 });
  } } });
  await assert.rejects(holdVoicePreflight(db, "attempt", "error"), /Keep dispatch held/);
  assert.equal(patches, 0);
});
