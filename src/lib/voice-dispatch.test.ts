import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { queryDb } from "./testing/query-db.ts";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "./voice-booking.ts";
import { voiceAssistantPayload } from "./voice-assistant.ts";

const require = createRequire(import.meta.url);
const id = "10000000-0000-4000-8000-000000000001", personId = "10000000-0000-4000-8000-000000000002";
const config = { id: true, enabled: true, starts_at: "2020-01-01T00:00:00Z", ends_at: "2035-01-01T00:00:00Z", booking_test_passed: true, voicemail_test_passed: true, optout_test_passed: true };
function harness(options: { config?: Record<string, unknown> | null; eligible?: boolean; failure?: boolean; phoneKind?: "direct" | "company" } = {}) {
  const memory = queryDb({ voice_pilot_config: options.config === null ? [] : [options.config ?? config], voice_eligibility: [{ person_id: personId, timezone: "America/New_York", approved_until: "2035-01-01T00:00:00Z", approved_number: "+15555550100", approval_basis: "written_consent", approval_evidence: "Documented permission", delay_business_days: 1 }], voice_attempts: [{ id, status: "creating" }] });
  let claims = 0, calls = 0, attached = 0, held = 0;
  let callPayload: unknown;
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./voice-dispatch.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date, process: { env: { VAPI_ASSISTANT_ID: "assistant-1", VAPI_WEBHOOK_SECRET: "test-secret-that-is-long-enough-for-testing" } },
    require: (name: string) => {
      if (name === "./supabase/admin.ts") return { admin: () => ({ ...memory.db, rpc: async () => { claims++; return { data: [{ id, task_id: id, person_id: personId, destination: "+15555550100", eligibility_expires_at: "2035-01-01T00:00:00Z" }], error: null }; } }) };
      if (name === "./call-tasks.ts") return { loadCallTasks: async () => options.eligible === false ? [] : [{ id, personId, name: "Morgan", bounced: false, plan: { status: "pending", firstEmailAt: "2026-10-21T14:00:00Z", phone: { number: "+15555550100", kind: options.phoneKind ?? "direct" } } }] };
      if (name === "./voice-sent-context.ts") return { currentVoiceFollowup: async () => ({ context: { first_name: "Morgan", email_body: "Actual sent email", email_subject: "shipping handoffs", context_generated_at: new Date().toISOString() }, firstMessage: "Hi Morgan", instructions: "Use actual email", voicemailMessage: "Approved voicemail" }) };
      if (name === "./voice-policy.ts") return { VOICE_PROMPT_VERSION: "test", voiceEligibility: () => ({ allowed: true, reasons: [] }) };
      if (name === "./voice-assistant.ts") return { voiceAssistantPayload };
      if (name === "./voice-booking.ts") return { VOICE_BOOKING, VOICE_INSTRUCTIONS };
      if (name === "./voice-runtime.ts") return { attachVoiceCall: async () => { attached++; }, holdVoiceAttempt: async () => { held++; } };
      if (name === "./vapi.ts") return { vapiRequest: async (path: string, _method?: string, body?: unknown) => {
        if (path === "/call") { calls++; callPayload = body; if (options.failure) throw new Error("Provider timeout"); return { id: "call-1" }; }
        if (path === "/phone-number") return [{ id: "number-1", number: VOICE_BOOKING.callerNumber, assistantId: "assistant-1" }];
        if (path.startsWith("/phone-number/")) return { number: VOICE_BOOKING.callerNumber, assistantId: "assistant-1" };
        return { id: "assistant-1", model: { provider: "openai", model: "configured" } };
      } };
      return require(name);
    },
  });
  return { ...memory, run: exports.dispatchVoicePilot as () => Promise<Record<string, unknown>>, metrics: () => ({ claims, calls, attached, held, callPayload }) };
}

test("pilot stays off with missing setup, disabled switch, unpassed tests or future dates", async () => {
  for (const c of [null, { ...config, enabled: false }, { ...config, booking_test_passed: false }, { ...config, voicemail_test_passed: false }, { ...config, optout_test_passed: false }, { ...config, starts_at: "2034-01-01T00:00:00Z" }]) {
    const h = harness({ config: c });
    assert.equal((await h.run()).callsPlaced, 0);
    assert.equal(h.metrics().claims, 0);
    assert.equal(h.metrics().calls, 0);
  }
});
test("pilot refresh prevents dialing a contact removed by reply, bounce, meeting or opt-out", async () => {
  const h = harness({ eligible: false });
  await assert.rejects(h.run(), /no longer eligible/);
  assert.equal(h.metrics().calls, 0);
  assert.equal(h.metrics().held, 1);
});
test("pilot places one real follow-up with approved voicemail and saves its provider ID", async () => {
  const h = harness();
  assert.equal((await h.run()).callsPlaced, 1);
  assert.equal(h.metrics().calls, 1);
  assert.equal(h.metrics().attached, 1);
  const body = h.metrics().callPayload as { customer: { number: string }; assistantOverrides: { voicemailMessage: string; model: { messages: Array<{ content: string }> } } };
  assert.equal(body.customer.number, "+15555550100");
  assert.equal(body.assistantOverrides.voicemailMessage, "Approved voicemail");
  assert.match(body.assistantOverrides.model.messages[0].content, /live approved follow-up/);
});
test("uncertain provider response is held without a blind retry", async () => {
  const h = harness({ failure: true });
  await assert.rejects(h.run(), /Provider timeout/);
  assert.equal(h.metrics().calls, 1);
  assert.equal(h.metrics().held, 1);
});

test("company lines let the model distinguish menus from reception before speaking", async () => {
  const h = harness({ phoneKind: "company" });
  assert.equal((await h.run()).callsPlaced, 1);
  const body = h.metrics().callPayload as { assistantOverrides: { firstMessage: string; model: { messages: Array<{ content: string }> } } };
  assert.equal(body.assistantOverrides.firstMessage, "");
  assert.match(body.assistantOverrides.model.messages[0].content, /Use the dtmf tool/);
  assert.doesNotMatch(body.assistantOverrides.firstMessage, /shipping|email|handoffs/i);
  assert.match(body.assistantOverrides.model.messages[0].content, /After a new person answers, briefly introduce yourself and confirm their identity/);
  assert.match(body.assistantOverrides.model.messages[0].content, /Never pitch a workflow or offer a meeting to reception/);
});
