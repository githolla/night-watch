import assert from "node:assert/strict";
import test from "node:test";
import { queryDb } from "./testing/query-db.ts";
import { emailSuppressed, isOptOutReply, likeLiteral, optOutPerson } from "./email-suppression.ts";

const seed = () => ({
  people: [
    { id: "p1", email: "Dana.Ortiz@acme.test", do_not_contact: false },
    { id: "p2", email: "dana.ortiz@ACME.test", do_not_contact: false },
    { id: "p3", email: "danaxortiz@acme.test", do_not_contact: false },
    { id: "p4", email: null, do_not_contact: false },
  ],
  cadences: [
    { id: "c1", person_id: "p1", card_id: "card-1", status: "active" },
    { id: "c2", person_id: "p2", card_id: "card-2", status: "paused" },
    { id: "c3", person_id: "p3", card_id: "card-3", status: "active" },
  ],
  cadence_steps: [
    { id: "s1", cadence_id: "c1", status: "pending", sent_at: null },
    { id: "s2", cadence_id: "c2", status: "ready", sent_at: null },
    { id: "s3", cadence_id: "c3", status: "pending", sent_at: null },
    { id: "s4", cadence_id: "c2", status: "sent", sent_at: "2026-09-30T14:00:00Z" },
  ],
});

test("a bare 'No thanks' or a negative reply is an opt-out; 'No problem, Tuesday works' is not", () => {
  assert.equal(isOptOutReply("No thanks.\n\nOn Tue, Sep 29, Josh wrote:\n> Would this help?", "neutral"), true);
  assert.equal(isOptOutReply("> quoted\nPlease remove me!", null), true);
  assert.equal(isOptOutReply("Not interested", "objection"), true);
  assert.equal(isOptOutReply("Happy to chat but we are set for now", "negative"), true);
  assert.equal(isOptOutReply("No problem, Tuesday works", "positive"), false);
  assert.equal(isOptOutReply("No problem, Tuesday works", "neutral"), false);
  assert.equal(isOptOutReply("No", "referral"), false);
  assert.equal(isOptOutReply("No, but talk to Sam", "neutral"), false);
});

test("opting out flags every row with the address in any case and stops every card's sequence", async () => {
  const { db, tables } = queryDb(seed());
  await optOutPerson(db, "p1");
  const flagged = Object.fromEntries(tables.people.map((row) => [row.id, row.do_not_contact]));
  assert.deepEqual(flagged, { p1: true, p2: true, p3: false, p4: false });
  assert.equal(tables.cadences.find((row) => row.id === "c2")?.status, "stopped", "a second card's paused sequence stops");
  assert.equal(tables.cadences.find((row) => row.id === "c3")?.status, "active", "a different address is untouched");
  assert.equal(tables.cadence_steps.find((row) => row.id === "s2")?.status, "skipped");
  assert.equal(tables.cadence_steps.find((row) => row.id === "s4")?.status, "sent", "a sent step is history");
});

test("a person with no address is opted out by id", async () => {
  const { db, tables } = queryDb(seed());
  await optOutPerson(db, "p4");
  assert.equal(tables.people.find((row) => row.id === "p4")?.do_not_contact, true);
  assert.equal(tables.people.filter((row) => row.do_not_contact).length, 1);
});

test("a failed write is reported so the unsubscribe link answers 500 and Gmail retries", async () => {
  const { db, fail } = queryDb(seed());
  fail("people", "update");
  await assert.rejects(optOutPerson(db, "p1"), /Could not save the opt-out/);
});

test("an address flagged on another row is suppressed, in any case, and only that address", async () => {
  const { db } = queryDb({ people: [{ id: "old", email: "Dana.Ortiz@Acme.test", do_not_contact: true }, { id: "new", email: "dana.ortiz@acme.test", do_not_contact: false }] });
  assert.equal(await emailSuppressed(db, "DANA.ORTIZ@acme.test"), true);
  assert.equal(await emailSuppressed(db, "dana_ortiz@acme.test"), false, "_ is not a wildcard");
  assert.equal(await emailSuppressed(db, ""), false);
});

test("the suppression check fails closed", async () => {
  const { db, fail } = queryDb({ people: [] });
  fail("people", "select");
  await assert.rejects(emailSuppressed(db, "dana@acme.test"), /Nothing was sent/);
});

test("like patterns are escaped", () => {
  assert.equal(likeLiteral("a_b%c\\d@x.test"), "a\\_b\\%c\\\\d@x.test");
});
