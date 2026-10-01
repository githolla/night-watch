import assert from "node:assert/strict";
import test from "node:test";
import { memoryDb } from "./testing/memory-db.ts";
import { checkRecipient, markBounced, recipientAllowed, recordDelivery, recordRecipientCheck, type RecipientPerson } from "./recipient-verification.ts";
import type { VerifyResult } from "./email-verify.ts";

const account = { id: "acct", domain: "acme.test" };
const person = (overrides: Partial<RecipientPerson> = {}): RecipientPerson => ({ id: "p1", full_name: "Dana Ortiz", email: "dana.ortiz@acme.test", email_status: "unverified", email_source: "pattern", ...overrides });
const colleagues = [
  { id: "c1", account_id: "acct", full_name: "Sam Reyes", email: "sam.reyes@acme.test", email_status: "verified", email_source: "apollo" },
  { id: "c2", account_id: "acct", full_name: "Lee Park", email: "lee.park@acme.test", email_status: "unverified", email_source: "published" },
];
const hunterSays = (status: VerifyResult["status"]) => async () => ({ status, score: 90 });
const hunterDown = async (): Promise<VerifyResult> => { throw new Error("Hunter email-verifier failed: 429"); };
const neverHunter = async (): Promise<VerifyResult> => { throw new Error("Hunter must not be called"); };
const mailOk = async () => true;

test("an address that cannot exist is refused before anything is spent", async () => {
  const { db } = memoryDb();
  for (const email of [null, "not-an-address", "dana@", "dana ortiz@acme.test"]) {
    const check = await checkRecipient(db, person({ email }), account, { hunter: neverHunter, mailHost: mailOk });
    assert.equal(check.level, "undeliverable", String(email));
    assert.equal(recipientAllowed(check, false), false);
  }
});

test("a bounced address stays blocked, even by hand", async () => {
  const { db } = memoryDb();
  const check = await checkRecipient(db, person({ email_status: "invalid" }), account, { hunter: neverHunter, mailHost: mailOk });
  assert.equal(check.level, "undeliverable");
  assert.equal(recipientAllowed(check, false), false);
});

test("a verified address or one that already took an email is deliverable without asking Hunter", async () => {
  const { db } = memoryDb();
  const verified = await checkRecipient(db, person({ email_status: "verified", email_verified_at: new Date().toISOString() }), account, { hunter: neverHunter });
  assert.equal(verified.level, "deliverable");
  const delivered = await checkRecipient(db, person({ email_check: { lastSentEmail: "dana.ortiz@acme.test", lastSentAt: new Date(Date.now() - 2 * 3600_000).toISOString() } }), account, { hunter: neverHunter });
  assert.equal(delivered.level, "deliverable");
  assert.equal(recipientAllowed(delivered, true), true, "the follow-up cron may send to it");
  const justSent = await checkRecipient(db, person({ email_check: { lastSentEmail: "dana.ortiz@acme.test", lastSentAt: new Date().toISOString() } }), account, { hunter: hunterSays("unknown"), mailHost: mailOk });
  assert.notEqual(justSent.source, "history", "inside the bounce window a send is not yet proof of delivery");
});

test("Hunter decides when it can: valid is deliverable, invalid is blocked", async () => {
  const { db } = memoryDb();
  assert.equal((await checkRecipient(db, person(), account, { hunter: hunterSays("verified"), mailHost: mailOk })).level, "deliverable");
  const invalid = await checkRecipient(db, person(), account, { hunter: hunterSays("invalid"), mailHost: mailOk });
  assert.equal(invalid.level, "undeliverable");
  assert.equal(invalid.source, "hunter");
});

test("when Hunter cannot answer, a domain with no mail server is blocked", async () => {
  const { db } = memoryDb();
  const check = await checkRecipient(db, person(), account, { hunter: hunterSays("unknown"), mailHost: async () => false });
  assert.equal(check.level, "undeliverable");
  assert.match(check.reason, /does not accept email/);
});

test("when Hunter is down, the company's proven format decides: matching is sendable by hand, not by the cron", async () => {
  const { db } = memoryDb({ people: colleagues });
  const check = await checkRecipient(db, person(), account, { hunter: hunterDown, mailHost: mailOk });
  assert.equal(check.level, "risky");
  assert.equal(check.source, "own");
  assert.match(check.reason, /first\.last format, proven by 2 real addresses/);
  assert.match(String(check.hunter), /429/);
  assert.equal(recipientAllowed(check, false), true);
  assert.equal(recipientAllowed(check, true), false);
});

test("an address that breaks a confident company format comes back with the address the format builds", async () => {
  const { db } = memoryDb({ people: [...colleagues, { id: "c3", account_id: "acct", full_name: "Kim Bell", email: "kim.bell@acme.test", email_status: "verified", email_source: "hunter" }] });
  const check = await checkRecipient(db, person({ email: "dortiz@acme.test" }), account, { hunter: hunterSays("unknown"), mailHost: mailOk });
  assert.equal(check.level, "risky");
  assert.equal(check.suggestion, "dana.ortiz@acme.test");
});

test("our own guesses never count as proof of the company's format", async () => {
  const { db } = memoryDb({ people: [{ id: "g1", account_id: "acct", full_name: "Sam Reyes", email: "sam.reyes@acme.test", email_status: "unverified", email_source: "pattern" }] });
  const check = await checkRecipient(db, person(), account, { hunter: hunterSays("unknown"), mailHost: mailOk });
  assert.doesNotMatch(check.reason, /proven by/);
});

test("a bounce teaches the system: the address is marked invalid and the next check refuses it", async () => {
  const { db, tables } = memoryDb({ people: [...colleagues, { ...person({ email: "dortiz@acme.test" }), account_id: "acct" }] });
  const suggestion = await markBounced(db, person({ email: "dortiz@acme.test" }), account);
  const stored = tables.people.find((row) => row.id === "p1")!;
  assert.equal(stored.email_status, "invalid");
  assert.equal(suggestion, "dana.ortiz@acme.test");
  const again = await checkRecipient(db, stored as RecipientPerson, account, { hunter: neverHunter, mailHost: mailOk });
  assert.equal(again.level, "undeliverable");
});

test("results are saved and reused, so Hunter is asked once per address per week", async () => {
  const { db, tables } = memoryDb({ people: [{ ...person(), account_id: "acct" }] });
  let calls = 0;
  const hunter = async (): Promise<VerifyResult> => { calls += 1; return { status: "catch_all", score: 50 }; };
  const first = await checkRecipient(db, person(), account, { hunter, mailHost: mailOk });
  await recordRecipientCheck(db, person(), first);
  const saved = tables.people[0] as RecipientPerson;
  assert.equal(saved.email_status, "catch_all");
  await checkRecipient(db, saved, account, { hunter, mailHost: mailOk });
  assert.equal(calls, 1);
});

test("recording a delivery starts the bounce window for that exact address", async () => {
  const { db, tables } = memoryDb({ people: [{ ...person(), account_id: "acct" }] });
  await recordDelivery(db, "p1", "Dana.Ortiz@acme.test");
  const check = tables.people[0].email_check as { lastSentEmail: string; lastSentAt: string };
  assert.equal(check.lastSentEmail, "dana.ortiz@acme.test");
  assert.ok(Date.parse(check.lastSentAt) > Date.now() - 5000);
});
