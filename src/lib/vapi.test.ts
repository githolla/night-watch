import test from "node:test";
import assert from "node:assert/strict";
import { vapiRequest, vapiStatus } from "./vapi.ts";

test("Vapi status exposes summaries without provider credentials", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.VAPI_API_KEY;
  process.env.VAPI_API_KEY = "test-private-key";
  globalThis.fetch = async (input, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer test-private-key");
    return Response.json(String(input).includes("/assistant")
      ? [{ id: "assistant-1", name: "Nightwatch", model: { provider: "openai", model: "configured", apiKey: "hidden" }, server: { headers: { Authorization: "hidden" } } }]
      : [{ id: "phone-1", number: "+12015814309", provider: "twilio", twilioAuthToken: "hidden" }]);
  };
  try {
    const status = await vapiStatus();
    assert.equal(status.connected, true);
    assert.equal(status.numbers[0].number, "+12015814309");
    assert.equal(JSON.stringify(status).includes("hidden"), false);
    assert.equal(JSON.stringify(status).includes("test-private-key"), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = originalKey;
  }
});

test("provider errors omit raw response bodies", async () => {
  const originalFetch = globalThis.fetch, originalKey = process.env.VAPI_API_KEY;
  process.env.VAPI_API_KEY = "test-private-key";
  globalThis.fetch = async () => new Response("sensitive provider response", { status: 401 });
  try { await assert.rejects(vapiRequest("/assistant"), { message: "Vapi request failed (401)." }); }
  finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VAPI_API_KEY;
    else process.env.VAPI_API_KEY = originalKey;
  }
});
