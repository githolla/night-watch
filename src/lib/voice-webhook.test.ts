import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function webhook(env: Record<string, string | undefined>) {
  let calls = 0;
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(new URL("../app/api/voice/vapi/route.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, {
    exports, Buffer, Response, process: { env },
    require: (name: string) => {
      if (name === "@/lib/voice-analysis") return { voiceStructuredResult: () => null };
      if (name === "@/lib/voice-runtime") return {
        boundVoiceAttempt: async (id: string) => { if (id === "unknown") throw new Error("Unknown call"); return { id: "attempt-1" }; },
        executeVoiceTool: async (_attempt: unknown, _id: string, _name: string, args: unknown) => {
          const input = args as { start?: string };
          if (!input.start || !Number.isFinite(Date.parse(input.start))) throw new Error("Invalid date");
          calls++; return { slots: [] };
        },
        saveVoiceReport: async () => { calls++; return {}; },
      };
      return require(name);
    },
  });
  return { post: exports.POST as (request: Request) => Promise<Response>, calls: () => calls };
}
const payload = (assistant = "assistant-1", args: unknown = { start: "2035-10-21T14:00:00Z", end: "2035-10-21T14:30:00Z", prospectRequested: false }) => ({
  message: { type: "tool-calls", call: { id: "call-1", assistantId: assistant }, toolCallList: [{ id: "tool-1", function: { name: "nightwatch_availability", arguments: args } }] },
});
const request = (body: unknown, token = "secret") => new Request("https://example.com/api/voice/vapi", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
test("voice callback refuses missing configuration and incorrect credentials", async () => {
  for (const env of [{}, { VAPI_WEBHOOK_SECRET: "secret" }, { VAPI_WEBHOOK_SECRET: "secret", VAPI_ASSISTANT_ID: "assistant-1" }]) {
    const hook = webhook(env);
    assert.equal((await hook.post(request(payload(), "wrong"))).status, 401);
    assert.equal(hook.calls(), 0);
  }
});
test("voice callback rejects another assistant before calendar access", async () => {
  const hook = webhook({ VAPI_WEBHOOK_SECRET: "secret", VAPI_ASSISTANT_ID: "assistant-1" });
  assert.equal((await hook.post(request(payload("other")))).status, 403);
  assert.equal(hook.calls(), 0);
});
test("voice tool results preserve IDs and validate inputs without calendar access", async () => {
  const hook = webhook({ VAPI_WEBHOOK_SECRET: "secret", VAPI_ASSISTANT_ID: "assistant-1" });
  const failed = await hook.post(request(payload("assistant-1", { start: "bad" })));
  const failure = await failed.json() as { results: Array<{ toolCallId: string; result: string }> };
  assert.equal(failure.results[0].toolCallId, "tool-1");
  assert.equal(JSON.parse(failure.results[0].result).success, false);
  assert.equal(hook.calls(), 0);
  const passed = await hook.post(request(payload()));
  const success = await passed.json() as { results: Array<{ result: string }> };
  assert.equal(JSON.parse(success.results[0].result).success, true);
  assert.equal(hook.calls(), 1);
});

test("voice callback rejects unbound calls before executing tools", async () => {
  const hook = webhook({ VAPI_WEBHOOK_SECRET: "secret", VAPI_ASSISTANT_ID: "assistant-1" });
  const data = payload();
  data.message.call.id = "unknown";
  assert.equal((await hook.post(request(data))).status, 409);
  assert.equal(hook.calls(), 0);
});
test("authenticated end-of-call report is persisted without executing a tool", async () => {
  const hook = webhook({ VAPI_WEBHOOK_SECRET: "secret", VAPI_ASSISTANT_ID: "assistant-1" });
  const response = await hook.post(request({ message: { type: "end-of-call-report", call: { id: "call-1", assistantId: "assistant-1" }, endedReason: "customer-ended-call", transcript: "Test conversation" } }));
  assert.equal(response.status, 200);
  assert.equal(hook.calls(), 1);
});
