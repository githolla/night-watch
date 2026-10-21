import test from "node:test";
import assert from "node:assert/strict";
import { checkVoiceTransport } from "./voice-transport.ts";

test("transport diagnostic reports rejected credentials without exposing tokens", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ code: 20003, message: "Authentication failed", auth_token: "secret-token" }, { status: 401 });
  try {
    const result = await checkVoiceTransport({ provider: "twilio", twilioAccountSid: `AC${"0".repeat(32)}`, twilioAuthToken: "secret-token" });
    assert.equal("credentialsAccepted" in result && result.credentialsAccepted, false);
    assert.equal("errorCode" in result && result.errorCode, 20003);
    assert.equal(JSON.stringify(result).includes("secret-token"), false);
  } finally { globalThis.fetch = original; }
});
test("transport diagnostic reports when provider credentials cannot be checked", async () => {
  const result = await checkVoiceTransport({ provider: "twilio", twilioAccountSid: `AC${"0".repeat(32)}` });
  assert.equal(result.checked, false);
  assert.equal("accountSid" in result && result.accountSid, `AC${"0".repeat(32)}`);
});
