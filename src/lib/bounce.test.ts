import assert from "node:assert/strict";
import test from "node:test";
import { bounceReport, markTouchBounced, prioritizeThreads } from "./bounce.ts";
import { queryDb } from "./testing/query-db.ts";

const NOW = Date.parse("2026-10-01T15:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

test("threads sent in the last 48 hours are always read, and no thread is read twice", () => {
  const older = Array.from({ length: 1000 }, (_, index) => ({ id: `old-${index}`, sent_at: hoursAgo(72 + index) }));
  const recent = Array.from({ length: 5 }, (_, index) => ({ id: `new-${index}`, sent_at: hoursAgo(index * 10) }));
  for (const start of [0, 300, 999, 12_345]) {
    const slice = prioritizeThreads([...older.slice(0, 500), ...recent, ...older.slice(500)], start, NOW);
    assert.equal(slice.length, 300);
    for (const touch of recent) assert.ok(slice.includes(touch), `${touch.id} at start ${start}`);
    assert.equal(new Set(slice.map((touch) => touch.id)).size, slice.length);
  }
});

test("the older threads still take turns", () => {
  const older = Array.from({ length: 10 }, (_, index) => ({ id: `old-${index}`, sent_at: hoursAgo(100 + index) }));
  assert.deepEqual(prioritizeThreads(older, 3, NOW, 4).map((touch) => touch.id), ["old-3", "old-4", "old-5", "old-6"]);
  assert.deepEqual(prioritizeThreads([], 3, NOW), []);
});

test("a bounce is stamped once, marks the address bad and stops the sequence", async () => {
  const { db, tables } = queryDb({
    touches: [{ id: "t1", gmail_thread_id: "thread", card_id: "card", person_id: "p1", bounced_at: null }],
    people: [{ id: "p1", full_name: "Dana Ortiz", email: "dana@acme.test", email_status: "unverified", email_check: null, account_id: "acct", accounts: { domain: "acme.test" } }],
    cadences: [{ id: "c1", card_id: "card", status: "active" }],
    cadence_steps: [{ id: "s1", cadence_id: "c1", status: "pending", sent_at: null }],
  });
  await markTouchBounced(db, { card_id: "card", person_id: "p1", gmail_thread_id: "thread" }, new Date(NOW));
  await markTouchBounced(db, { card_id: "card", person_id: "p1", gmail_thread_id: "thread" }, new Date(NOW + 60_000));
  assert.equal(tables.touches[0].bounced_at, new Date(NOW).toISOString());
  assert.equal(tables.people[0].email_status, "invalid");
  assert.equal(tables.cadences[0].status, "stopped");
  assert.equal(tables.cadence_steps[0].status, "skipped");
});

test("shared Gmail threads do not stamp unrelated contacts as bounced", async () => {
  const { db, tables } = queryDb({
    touches: [{ person_id: "p1", card_id: "card", sent_by: "josh", gmail_thread_id: "thread", bounced_at: null }, { person_id: "test", card_id: "test-card", sent_by: "suuchi", gmail_thread_id: "thread", bounced_at: null }],
    people: [{ id: "p1", full_name: "Dana Ortiz", email: "dana@co.test", email_status: "unverified", account_id: "acct" }],
  });
  await markTouchBounced(db, { card_id: "card", person_id: "p1", sent_by: "josh", gmail_thread_id: "thread" }, new Date(NOW));
  assert.equal(tables.touches[0].bounced_at, new Date(NOW).toISOString());
  assert.equal(tables.touches[1].bounced_at, null);
});


test("delivery reports distinguish missing mailboxes, restricted groups and temporary delays", async () => {
  for (const [status, category] of [["5.1.1", "invalid"], ["5.4.1", "invalid"], ["5.7.133", "policy_restricted"], ["4.2.2", "temporary"]]) {
    const report = bounceReport({ id: "bounce", internalDate: String(NOW), payload: { headers: [{ name: "X-Failed-Recipients", value: "Dana@co.test" }], parts: [{ body: { data: Buffer.from(`Final-Recipient: rfc822; dana@co.test\nStatus: ${status}\nDiagnostic-Code: smtp; ${status.startsWith("4") ? "450" : "550"} ${status} failed`).toString("base64url") } }] } });
    assert.equal(report.recipient, "dana@co.test");
    assert.equal(report.category, category);
    if (category === "temporary") {
      const { db, tables } = queryDb({ people: [{ id: "p1", email: "dana@co.test", email_status: "unverified" }], touches: [{ person_id: "p1", card_id: "card", gmail_thread_id: "thread", bounced_at: null }] });
      assert.equal(await markTouchBounced(db, { card_id: "card", person_id: "p1", gmail_thread_id: "thread" }, new Date(NOW), report), false);
      assert.equal(tables.people[0].email_status, "unverified");
      assert.equal(tables.touches[0].bounced_at, null);
    }
  }
});

test("a late failure on an old address preserves a verified replacement and its active cadence", async () => {
  const { db, tables } = queryDb({
    people: [{ id: "p", full_name: "Dana Ortiz", email: "new@co.test", email_status: "verified", email_source: "hunter", email_check: { email: "new@co.test", sentAddresses: { old: "old@co.test" } } }],
    touches: [{ card_id: "card", person_id: "p", gmail_thread_id: "old", bounced_at: null }],
    cadences: [{ id: "cad", card_id: "card", status: "active" }],
  });
  await markTouchBounced(db, { card_id: "card", person_id: "p", gmail_thread_id: "old" }, new Date(NOW), { recipient: "old@co.test", status: "5.1.1", diagnostic: "Mailbox not found", category: "invalid", messageId: "failure", at: new Date(NOW).toISOString() });
  assert.equal(tables.people[0].email_status, "verified");
  assert.equal(tables.cadences[0].status, "active");
  assert.deepEqual((tables.people[0].email_check as { bouncedEmails: string[] }).bouncedEmails, ["old@co.test"]);
});
