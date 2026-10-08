import test from "node:test";
import assert from "node:assert/strict";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";

test("Send all takes verified addresses and researched likely ones for that exact address, nothing else", () => {
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "verified" }), true);
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "unverified", email_check: { likely: true, email: "a@x.test" } }), true);
  assert.equal(bulkSendable({ email: "b@x.test", email_status: "unverified", email_check: { likely: true, email: "a@x.test" } }), false, "likely applies only to the address it was judged on");
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "invalid", email_check: { likely: true, email: "a@x.test" } }), false, "a bounced address never goes out in bulk");
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "unverified" }), false);
  assert.equal(bulkSendable({ email: null, email_status: "verified" }), false);
});

test("sendable: any address not known to be bad, confirmed or not", () => {
  assert.equal(sendableAddress({ email: "a@acme.com", email_status: "unverified", email_check: { level: "risky" } }), true);
  assert.equal(sendableAddress({ email: "a@acme.com", email_status: "verified" }), true);
  assert.equal(sendableAddress({ email: null, email_status: "none" }), false);
  assert.equal(sendableAddress({ email: "a@acme.com", email_status: "invalid" }), false);
  assert.equal(sendableAddress({ email: "a@acme.com", email_status: "unverified", email_check: { bouncedEmail: "a@acme.com" } }), false);
  assert.equal(sendableAddress({ email: "a@acme.com", email_status: "unverified", email_check: { level: "undeliverable", email: "a@acme.com" } }), false);
  assert.equal(sendableAddress({ email: "b@acme.com", email_status: "unverified", email_check: { level: "undeliverable", email: "a@acme.com" } }), true, "a check on an older address does not block the new one");
});
