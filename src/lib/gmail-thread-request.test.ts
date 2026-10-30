import test from "node:test";
import assert from "node:assert/strict";
import { gmailThreadRequest } from "./gmail-thread-request.ts";
test("temporary Gmail read throttling retries without skipping the conversation check", async () => {
  let reads = 0;
  const waits: number[] = [];
  const response = await gmailThreadRequest("test", "thread", { fetcher: async () => ++reads === 1 ? Response.json({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }, { status: 403 }) : Response.json({ messages: [] }), wait: async ms => { waits.push(ms); } });
  assert.equal(response.status, 200);
  assert.equal(reads, 2);
  assert.deepEqual(waits, [1000]);
});
test("permission failures stay held and throttling has a finite retry limit", async () => {
  for (const reason of ["forbidden", "rateLimitExceeded"]) {
    let reads = 0;
    await assert.rejects(gmailThreadRequest("test", "thread", { fetcher: async () => { reads++; return Response.json({ error: { errors: [{ reason }] } }, { status: 403 }); }, wait: async () => undefined }), new RegExp(reason));
    assert.equal(reads, reason === "forbidden" ? 1 : 3);
  }
});
