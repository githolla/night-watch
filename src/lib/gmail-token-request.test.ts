import test from "node:test";
import assert from "node:assert/strict";
import { gmailTokenRequest } from "./gmail-token-request.ts";

test("transient Google token errors retry before holding a call", async () => {
  let reads = 0;
  const waits: number[] = [];
  const token = await gmailTokenRequest(new URLSearchParams(), { fetcher: async () => ++reads < 3 ? Response.json({ error: "temporarily_unavailable" }, { status: 503 }) : Response.json({ access_token: "example" }), wait: async ms => { waits.push(ms); } });
  assert.equal(token, "example");
  assert.deepEqual(waits, [1000, 2000]);
});
test("revoked authorization asks for reconnect once without exposing Google descriptions", async () => {
  let reads = 0;
  await assert.rejects(gmailTokenRequest(new URLSearchParams(), { fetcher: async () => { reads++; return Response.json({ error: "invalid_grant", error_description: "private token details" }, { status: 400 }); } }), error => error instanceof Error && /Reconnect/.test(error.message) && !error.message.includes("private"));
  assert.equal(reads, 1);
});
test("network errors have a bounded retry budget", async () => {
  let reads = 0;
  await assert.rejects(gmailTokenRequest(new URLSearchParams(), { fetcher: async () => { reads++; throw new Error("network"); }, wait: async () => undefined }), /temporarily unavailable/);
  assert.equal(reads, 3);
});
