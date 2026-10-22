import test from "node:test";
import assert from "node:assert/strict";
import { voiceAssistantPayload } from "./voice-assistant.ts";

const secret = "test-webhook-secret-long-enough-for-tests";
const assistant = { id: "assistant-1", voice: { provider: "configured" }, model: { provider: "openai", model: "configured", temperature: 0.2, messages: [{ role: "system", content: "Old template" }] } };
test("assistant setup preserves model settings and replaces template instructions", () => {
  const payload = voiceAssistantPayload(assistant, secret);
  const model: Record<string, unknown> = payload.model;
  assert.equal(model.model, "configured");
  assert.equal(model.temperature, 0.2);
  assert.equal(JSON.stringify(payload).includes("Old template"), false);
  assert.match(payload.model.messages[0].content, /answer plainly that you are an automated assistant/);
  assert.equal(payload.server.headers.Authorization, `Bearer ${secret}`);
  assert.equal(payload.model.tools.some(tool => tool.type === "transferCall"), true);
  assert.equal("voice" in payload, false);
});
test("setup refuses existing integrations or unidentified functions", () => {
  assert.throws(() => voiceAssistantPayload({ ...assistant, server: { url: "https://other.example.com" } }, secret), /another server/);
  assert.throws(() => voiceAssistantPayload({ ...assistant, model: { ...assistant.model, toolIds: ["tool-1"] } }, secret), /saved tools/);
  assert.throws(() => voiceAssistantPayload({ ...assistant, model: { ...assistant.model, tools: [{ type: "function", function: { name: "other" } }] } }, secret), /unrelated function/);
  assert.throws(() => voiceAssistantPayload(assistant, "short"), /strong/);
});
test("repeating setup does not duplicate calendar or transfer tools", () => {
  const first = voiceAssistantPayload(assistant, secret);
  const second = voiceAssistantPayload({ ...first, id: assistant.id }, secret);
  assert.equal(first.model.tools.length, second.model.tools.length);
});
test("conversation timing waits for email fragments and suppresses automatic tool fillers", () => {
  const payload = voiceAssistantPayload(assistant, secret);
  assert.equal(payload.startSpeakingPlan.smartEndpointingPlan.provider, "livekit");
  assert.ok(payload.startSpeakingPlan.customEndpointingRules.every(rule => ["assistant", "customer", "both"].includes(rule.type)));
  assert.ok(payload.startSpeakingPlan.customEndpointingRules.some(rule => new RegExp(rule.regex).test("joshlee at 967") && rule.timeoutSeconds >= 2));
  for (const tool of payload.model.tools.filter(tool => tool.type === "function")) {
    assert.deepEqual(tool.messages, [{ type: "request-start", content: "" }]);
  }
});

test("outbound greeting waits for hello and selected voice is applied explicitly", () => {
  const payload = voiceAssistantPayload(assistant, secret, "clara");
  assert.equal(payload.firstMessageMode, "assistant-waits-for-user");
  assert.equal(payload.firstMessageInterruptionsEnabled, true);
  assert.deepEqual(payload.voice, { provider: "vapi", voiceId: "Clara", version: 2 });
  assert.equal(voiceAssistantPayload(assistant, secret, "sid").voice?.voiceId, "Sid");
  assert.deepEqual(voiceAssistantPayload(assistant, secret, "savannah").voice, { provider: "vapi", voiceId: "Savannah", version: 1 });
  assert.equal(payload.stopSpeakingPlan.numWords, 1);
});
