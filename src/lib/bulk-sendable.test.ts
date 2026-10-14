import test from "node:test";
import assert from "node:assert/strict";
import { bulkSendable, sendableAddress, researchedAddressProblem } from "./bulk-sendable.ts";

test("a saved published replacement blocks the old guess even with send authorization", () => {
  const person = { email: "todd.leyse@co.test", email_status: "unverified", email_check: { publicResearch: { addressCandidate: "tleyse@co.test" }, outreachAuthorization: { email: "todd.leyse@co.test", authorizedAt: "2026-10-14T12:00:00Z" } } };
  assert.match(researchedAddressProblem(person)!, /has not been applied/);
  assert.equal(bulkSendable(person), false);
  assert.equal(researchedAddressProblem({ ...person, email: "tleyse@co.test" }), null);
  assert.equal(researchedAddressProblem({ ...person, email_check: { publicResearch: { addressCandidate: "tleyse@co.test", previouslyFailed: true } } }), null);
});

test("explicit research authorization is scoped to an address and never overrides failures", () => {
  const email_check = { email: "pat@co.test", level: "risky", outreachAuthorization: { email: "pat@co.test", authorizedAt: "2026-10-14T13:40:00Z" } };
  assert.equal(bulkSendable({ email: "pat@co.test", full_name: "Pat Lee", email_status: "unverified", email_check }), true);
  assert.equal(bulkSendable({ email: "other@co.test", email_status: "unverified", email_check }), false);
  assert.equal(bulkSendable({ email: "pat@co.test", email_status: "invalid", email_check }), false);
  assert.equal(bulkSendable({ email: "pat@co.test", email_status: "unverified", email_check: { ...email_check, bouncedEmails: ["pat@co.test"] } }), false);
});

test("bulk sends require verification and refuse pattern evidence", () => {
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "verified" }), true);
  assert.equal(bulkSendable({ email: "a@x.test", email_status: "unverified", email_check: { likely: true, email: "a@x.test" } }), false);
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

test("legacy publication and manual confirmations cannot masquerade as mailbox verification", () => {
  assert.equal(bulkSendable({ email: "pat@co.test", email_status: "verified", email_source: "published" }), false);
  assert.equal(bulkSendable({ email: "pat@co.test", email_status: "verified", email_source: "manual" }), false);
  assert.equal(bulkSendable({ email: "sales@co.test", full_name: "Pat Lee", email_status: "verified", email_source: "hunter" }), false);
  assert.equal(bulkSendable({ email: "pat@co.test", full_name: "Pat Lee", email_status: "verified", email_source: "hunter", email_check: { email: "pat@co.test", level: "deliverable" } }), true);
});
