import test from "node:test";
import assert from "node:assert/strict";
import { bulkSendable } from "./bulk-sendable.ts";

test("Send all takes verified addresses and researched likely ones for that exact address, nothing else", () => {
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "verified" }), true);
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "unverified", email_check: { likely: true, email: "a@x.test" } }), true);
  assert.equal(bulkSendable({ email: "b@x.test", email_status: "unverified", email_check: { likely: true, email: "a@x.test" } }), false, "likely applies only to the address it was judged on");
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "invalid", email_check: { likely: true, email: "a@x.test" } }), false, "a bounced address never goes out in bulk");
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "unverified" }), false);
  assert.equal(bulkSendable({ email: null, email_status: "verified" }), false);
});
