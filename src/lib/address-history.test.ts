import test from "node:test";
import assert from "node:assert/strict";
import { addressRejected, rejectedAddresses, replacementCheck } from "./address-history.ts";
import { queryDb } from "./testing/query-db.ts";

test("changing an address preserves every failure and never carries verification to its replacement", async () => {
  const person = { email: "old@co.test", email_status: "invalid", email_check: { email: "old@co.test", level: "undeliverable", bouncedEmails: ["older@co.test"], lastSentEmail: "old@co.test" } };
  const check = replacementCheck(person, { email: "new@co.test" });
  assert.deepEqual(check.bouncedEmails, ["older@co.test", "old@co.test"]);
  assert.equal(check.level, "risky");
  assert.equal(check.lastSentEmail, null);
  const { db } = queryDb({ people: [{ email: "new@co.test", email_status: "unverified", email_check: check }] });
  assert.equal(await addressRejected(db, "OLD@co.test"), true);
  assert.equal(await addressRejected(db, "new@co.test"), false);
  assert.deepEqual(rejectedAddresses({ email_check: JSON.stringify(check) }), ["older@co.test", "old@co.test"]);
});

test("failed-address checks refuse to send if history is unavailable", async () => {
  const h = queryDb();
  h.fail("people", "select");
  await assert.rejects(addressRejected(h.db, "pat@co.test"), /Could not check/);
});
