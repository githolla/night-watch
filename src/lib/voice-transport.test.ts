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
test("saved Twilio credentials read permissions without exposing the token", async () => {
  const original = globalThis.fetch;
  const oldSid = process.env.TWILIO_ACCOUNT_SID;
  const oldToken = process.env.TWILIO_AUTH_TOKEN;
  process.env.TWILIO_ACCOUNT_SID = `AC${"1".repeat(32)}`;
  process.env.TWILIO_AUTH_TOKEN = "saved-private-token";
  globalThis.fetch = async (url) => String(url).includes("DialingPermissions")
    ? Response.json({ low_risk_numbers_enabled: true })
    : Response.json({ status: "active" });
  try {
    const result = await checkVoiceTransport({ provider: "twilio", twilioAccountSid: process.env.TWILIO_ACCOUNT_SID });
    assert.equal(result.checked, true);
    assert.deepEqual("permissions" in result && result.permissions, { low_risk_numbers_enabled: true });
    assert.equal(JSON.stringify(result).includes("saved-private-token"), false);
    const mismatch = await checkVoiceTransport({ provider: "twilio", twilioAccountSid: `AC${"2".repeat(32)}` });
    assert.equal(mismatch.checked, false);
  } finally {
    globalThis.fetch = original;
    if (oldSid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = oldSid;
    if (oldToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = oldToken;
  }
});
