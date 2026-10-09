import assert from "node:assert/strict";
import test from "node:test";
import { outcomeOf, sentStats, shiftDate, type SentTouch } from "./sent-stats.ts";

const touch = (id: string, cardId: string, sentAt: string, extra: Partial<SentTouch> = {}): SentTouch => ({
  id, cardId, sentAt, replyAt: null, replyClass: "none", bouncedAt: null, name: "Dana Ortiz", title: "CEO", company: "Acme", subject: "An idea for Acme",
  industry: "Pest control", role: "CEOs and presidents", size: "$10M to $25M", ...extra,
});
const dayOf = (iso: string) => iso.slice(0, 10);

test("counts what went out in the period, with replies, interest, bounces and follow-ups", () => {
  const touches = [
    touch("a1", "a", "2026-10-01T14:00:00Z"),
    touch("a2", "a", "2026-10-06T14:00:00Z", { replyAt: "2026-10-06T18:00:00Z", replyClass: "positive" }),
    touch("b1", "b", "2026-10-08T14:00:00Z", { bouncedAt: "2026-10-08T14:05:00Z", industry: "Roofing", role: "Owners and founders" }),
    touch("c1", "c", "2026-10-09T14:00:00Z", { replyAt: "2026-10-09T15:00:00Z", replyClass: "ooo" }),
  ];
  const stats = sentStats(touches, 7, "2026-10-09", dayOf);
  assert.equal(stats.sent, 3);
  assert.equal(stats.followups, 1, "a2 follows a1, sent before the period");
  assert.equal(stats.firsts, 2);
  assert.equal(stats.replies, 1);
  assert.equal(stats.interested, 1);
  assert.equal(stats.bounced, 1);
  assert.equal(stats.replyRate, 33);
  assert.deepEqual(stats.recent.map((row) => [row.id, row.outcome, row.followup]), [["c1", "out of office", false], ["b1", "bounced", false], ["a2", "interested", true]]);
  assert.equal(stats.daily.length, 7);
  assert.deepEqual(stats.daily.at(-1), { date: "2026-10-09", label: "Today", sent: 1, replies: 0 });
  assert.deepEqual(stats.mix.industry, [{ label: "Pest control", count: 1 }, { label: "Roofing", count: 1 }]);
});

test("the chart shows at most fourteen days, and dates cross month ends", () => {
  assert.equal(sentStats([], 30, "2026-10-09", dayOf).daily.length, 14);
  assert.equal(shiftDate("2026-10-01", -1), "2026-09-30");
});

test("an auto-reply is not counted as a reply", () => {
  assert.equal(outcomeOf({ replyAt: "x", replyClass: "ooo", bouncedAt: null }), "out of office");
  assert.equal(outcomeOf({ replyAt: "x", replyClass: "none", bouncedAt: null }), "sent");
  assert.equal(outcomeOf({ replyAt: "x", replyClass: "objection", bouncedAt: null }), "replied");
});

test("first emails are split by version, so the test shows which one gets replies", () => {
  const touches = [
    touch("a", "a", "2026-10-08T14:00:00Z", { version: "Direct Offer", replyAt: "2026-10-08T15:00:00Z", replyClass: "positive" }),
    touch("b", "b", "2026-10-08T14:00:00Z", { version: "Direct Offer" }),
    touch("c", "c", "2026-10-08T14:00:00Z", { version: "Concrete Idea", bouncedAt: "2026-10-08T14:01:00Z" }),
    touch("c2", "c", "2026-10-09T14:00:00Z", { version: "Concrete Idea", replyAt: "2026-10-09T15:00:00Z", replyClass: "neutral" }),
    touch("d", "d", "2026-10-08T14:00:00Z", { version: null }),
  ];
  assert.deepEqual(sentStats(touches, 7, "2026-10-09", dayOf).versions, [
    { label: "Direct Offer", sent: 2, replies: 1, interested: 1, bounced: 0, replyRate: 50 },
    { label: "Concrete Idea", sent: 1, replies: 0, interested: 0, bounced: 1, replyRate: 0 },
    { label: "Not recorded", sent: 1, replies: 0, interested: 0, bounced: 0, replyRate: 0 },
  ]);
});
