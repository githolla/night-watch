import { VOICE_TEST_DURATION_SECONDS, VOICE_TURN_TIMING } from "./voice-conversation.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { voiceAssistantPayload } from "./voice-assistant.ts";
import { newCallPlan } from "./call-plan.ts";
import { voiceFollowup } from "./voice-followup.ts";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "./voice-booking.ts";

const require = createRequire(import.meta.url);
const assistantId = "5c23de70-09c0-47db-a265-8c88fc5c7cd7";
const phoneNumberId = "2bfff64d-829e-4058-9875-7119785dd4c2";
function route(number: string = VOICE_BOOKING.callerNumber, voice?: Record<string, unknown>) {
  const exports: Record<string, unknown> = {}, requests: Array<{ path: string; method: string; body: unknown }> = [];
  runInNewContext(ts.transpileModule(readFileSync(new URL("../app/api/cron/voice/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Response, Date, process: { env: { VAPI_ASSISTANT_ID: assistantId, VAPI_WEBHOOK_SECRET: "test-secret-that-is-long-enough-for-testing" } },
    require: (name: string) => {
      if (name === "@/lib/voice-conversation") return { VOICE_TEST_DURATION_SECONDS, VOICE_TURN_TIMING };
      if (name === "@/lib/voice-queue") return { prepareVoiceQueue: async () => ({ queued: 0, held: [], externalDispatchEnabled: false }) };
      if (name === "@/lib/voice-analysis") return { ensureVoiceStructuredOutput: async () => "output-1", voiceStructuredResult: () => null };
      if (name === "@/lib/voice-runtime") return { reserveInternalVoiceAttempt: async () => "attempt-1", attachVoiceCall: async () => undefined, holdVoiceAttempt: async () => undefined };
      if (name === "@/lib/voice-sent-context") return { currentVoiceFollowup: async (task: Parameters<typeof voiceFollowup>[0]) => voiceFollowup(task) };
      if (name === "@/lib/supabase/admin") return { admin: () => ({}) };
      if (name === "@/lib/call-tasks") return { loadCallTasks: async () => [{ id: "task", owner: "suuchi", name: "Sam Jones", title: "COO", company: "Example", domain: "example.test", email: "sam@example.test", emailBody: "Shipping handoffs", why: "Growing", bounced: false, plan: newCallPlan("2026-10-21T14:00:00Z") }] };
      if (name === "@/lib/voice-followup") return { voiceFollowup };
      if (name === "@/lib/auth") return { cronAuthorized: (request: Request) => request.headers.get("authorization") === "Bearer test-cron" };
      if (name === "@/lib/voice-assistant") return { voiceAssistantPayload };
      if (name === "@/lib/voice-booking") return { VOICE_BOOKING, VOICE_INSTRUCTIONS };
      if (name === "@/lib/voice-calendar") return { voiceAvailability: async () => ({ slots: [] }) };
      if (name === "@/lib/voice-transport") return { checkVoiceTransport: async () => ({ checked: false }) };
      if (name === "@/lib/vapi") return {
        vapiStatus: async () => ({ connected: true }),
        vapiRequest: async (path: string, method = "GET", body?: unknown) => {
          requests.push({ path, method, body });
          if (path.startsWith("/assistant")) return { id: assistantId, ...(voice ? { voice } : {}), model: { provider: "openai", model: "configured" } };
          if (path.startsWith("/phone-number")) return { number, assistantId };
          return { id: "test-call", status: "queued" };
        },
      };
      return require(name);
    },
  });
  return { post: exports.POST as (request: Request) => Promise<Response>, requests };
}
function request(action: string, authorized = true) {
  return new Request("https://example.com/api/cron/voice", {
    method: "POST", headers: { authorization: authorized ? "Bearer test-cron" : "wrong", "content-type": "application/json" },
    body: JSON.stringify({ action, assistantId, phoneNumberId, customer: { number: "+15555550100" } }),
  });
}
test("voice setup requires cron authorization before any provider request", async () => {
  const hook = route();
  assert.equal((await hook.post(request("configure", false))).status, 401);
  assert.equal(hook.requests.length, 0);
});
test("voice preview never mutates provider configuration or returns its secret", async () => {
  const hook = route(), response = await hook.post(request("preview"));
  assert.equal(response.status, 200);
  assert.equal(hook.requests.every(item => item.method === "GET"), true);
  assert.equal((await response.text()).includes("test-secret"), false);
});
test("internal call test is restricted to Josh even when another destination is supplied", async () => {
  const hook = route(), response = await hook.post(request("test-call"));
  assert.equal(response.status, 200);
  const call = hook.requests.find(item => item.path === "/call");
  assert.equal((call?.body as { customer: { number: string } }).customer.number, VOICE_BOOKING.transferNumber);
  assert.equal((call?.body as { assistantOverrides: { voicemailDetection: string } }).assistantOverrides.voicemailDetection, "off");
  assert.equal(hook.requests.filter(item => item.method === "POST").length, 1);
});
test("voice setup cannot reassign an unexpected originating phone number", async () => {
  const hook = route("+15555550100");
  assert.equal((await hook.post(request("configure"))).status, 400);
  assert.equal(hook.requests.some(item => item.method !== "GET"), false);
});
test("preview accepts the string voice version returned by Vapi", async () => {
  const hook = route(VOICE_BOOKING.callerNumber, { provider: "vapi", voiceId: "Elliot", version: "2", language: "en" });
  const response = await hook.post(request("preview"));
  assert.equal(response.status, 200);
  const body = await response.json() as { voice: { voiceId: string; version: string } };
  assert.equal(body.voice.voiceId, "Elliot");
  assert.equal(body.voice.version, "2");
  assert.equal(hook.requests.every(item => item.method === "GET"), true);
});

test("follow-up rehearsal attaches sent email but still only calls Josh", async () => {
  const hook = route();
  const response = await hook.post(request("test-followup"));
  assert.equal(response.status, 200);
  const call = hook.requests.find(item => item.path === "/call");
  const body = call?.body as { customer: { number: string }; assistantOverrides: { model: { messages: Array<{ content: string }> } } };
  assert.equal(body.customer.number, VOICE_BOOKING.transferNumber);
  assert.match(body.assistantOverrides.model.messages[0].content, /Shipping handoffs/);
  assert.match(body.assistantOverrides.model.messages[0].content, /internal roleplay/);
});
test("follow-up preview never places a call", async () => {
  const hook = route();
  assert.equal((await hook.post(request("followup-preview"))).status, 200);
  assert.equal(hook.requests.every(item => item.method === "GET"), true);
});
test("internal booking rehearsals have enough time to finish confirmation", async () => {
  const hook = route();
  assert.equal((await hook.post(request("test-followup"))).status, 200);
  const call = hook.requests.find(item => item.path === "/call");
  const body = call?.body as { assistantOverrides: { maxDurationSeconds: number; startSpeakingPlan: { smartEndpointingPlan: { provider: string } } } };
  assert.ok(body.assistantOverrides.maxDurationSeconds >= 600);
  assert.equal((call?.body as { assistantOverrides: { firstMessageMode: string } }).assistantOverrides.firstMessageMode, "assistant-waits-for-user");
  assert.equal(body.assistantOverrides.startSpeakingPlan.smartEndpointingPlan.provider, "livekit");
});
