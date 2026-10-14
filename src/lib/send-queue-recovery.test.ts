import test from "node:test";
import assert from "node:assert/strict";
import { matchingVerifiedBuyer, recoverSendQueue } from "./send-queue-recovery.ts";
import { queryDb } from "./testing/query-db.ts";
const match = { first_name: "Jane", last_name: "Doe", title: "CEO", linkedin_url: null, email: "jane.doe@company.com", email_status: "verified", currentDomain: "company.com", currentCompany: "Company", stillHere: true };
test("recovery accepts an exact verified buyer at their current employer", () => { assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", match), true); });
test("recovery refuses names, roles and employers that do not match", () => { assert.equal(matchingVerifiedBuyer("John Doe", "company.com", match), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "other.com", match), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, currentDomain: null }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, stillHere: false }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, email: "info@company.com" }), false); });
test("catch-all and uncertain provider responses cannot become verified", () => { assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", { ...match, email_status: "catch_all" }), false); assert.equal(matchingVerifiedBuyer("Jane Doe", "company.com", null), false); });

test("invalid provider credentials stop after the first bounded batch", async () => {
  const previous = process.env.APOLLO_API_KEY; process.env.APOLLO_API_KEY = "test-key";
  try {
    const people = Array.from({ length: 9 }, (_, i) => ({ id: String(i), full_name: "Jane Doe", email: null, email_status: "none", email_source: null, email_check: {}, do_not_contact: false }));
    const cards = people.map(person => ({ id: `card-${person.id}`, status: "new", assigned_to: "suuchi", auto_send_hold: false, auto_send_hold_reason: null, people: person, accounts: { id: person.id, name: "Company", domain: "company.com", status: "active" }, signals: { hash: "operator-shortlist-20260923:test" } }));
    const { db } = queryDb({ cards, people }); let calls = 0;
    const result = await recoverSendQueue(db, { matcher: async () => { calls++; throw new Error("Apollo match failed: 401"); } });
    assert.equal(calls, 3); assert.equal(result.verified, 0); assert.match(result.blocked || "", /Replace APOLLO_API_KEY/);
  } finally { if (previous === undefined) delete process.env.APOLLO_API_KEY; else process.env.APOLLO_API_KEY = previous; }
});
