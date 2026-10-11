import assert from "node:assert/strict";
import test from "node:test";
import { breakdown, dailySeries, funnel, recentActivity } from "./home-stats.ts";
import type { SentTouch } from "./sent-stats.ts";

const touch = (id: string, cardId: string, sentAt: string, extra: Partial<SentTouch> = {}): SentTouch => ({
  id, cardId, sentAt, replyAt: null, replyClass: null, bouncedAt: null, name: `Person ${cardId}`, title: "CEO", company: `Co ${cardId}`, subject: "Hi",
  industry: "Pest control", role: "Owner or CEO", size: "$10M to $50M", ...extra,
});
const dayOf = (iso: string) => iso.slice(0, 10);
const touches = [
  touch("a1", "a", "2026-10-01T14:00:00Z", { replyAt: "2026-10-02T15:00:00Z", replyClass: "positive" }),
  touch("a2", "a", "2026-10-06T14:00:00Z"),
  touch("b1", "b", "2026-10-06T14:10:00Z", { industry: "Construction", replyAt: "2026-10-07T10:00:00Z", replyClass: "neutral" }),
  touch("c1", "c", "2026-10-08T14:20:00Z", { industry: "Construction", bouncedAt: "2026-10-08T14:21:00Z" }),
  touch("d1", "d", "2026-10-08T14:30:00Z", { replyAt: "2026-10-08T16:00:00Z", replyClass: "ooo" }),
];

test("the daily series has every day, counts follow-ups apart from first emails, and ignores auto-replies", () => {
  const days = dailySeries(touches, 10, "2026-10-08", dayOf);
  assert.equal(days.length, 10);
  assert.equal(days[0].date, "2026-09-29");
  assert.equal(days.at(-1)?.date, "2026-10-08");
  const oct6 = days.find((day) => day.date === "2026-10-06");
  assert.deepEqual({ sent: oct6?.sent, firsts: oct6?.firsts, replies: oct6?.replies }, { sent: 2, firsts: 1, replies: 1 });
  const oct8 = days.find((day) => day.date === "2026-10-08");
  assert.deepEqual({ sent: oct8?.sent, replies: oct8?.replies, bounced: oct8?.bounced }, { sent: 2, replies: 0, bounced: 1 });
  assert.equal(days.find((day) => day.date === "2026-10-01")?.interested, 1);
});

test("the breakdown counts only first emails since the date, with a reply rate per group", () => {
  const rows = breakdown(touches, "industry", "2026-10-01", dayOf);
  assert.deepEqual(rows.map((row) => [row.label, row.sent, row.replies, row.rate]), [["Construction", 2, 1, 50], ["Pest control", 2, 1, 50]]);
  assert.deepEqual(breakdown(touches, "industry", "2026-10-07", dayOf).map((row) => [row.label, row.sent]), [["Construction", 1], ["Pest control", 1]]);
});

test("recent activity puts replies and bounces among the sends, newest first", () => {
  const events = recentActivity(touches, 4);
  assert.deepEqual(events.map((event) => event.kind), ["sent", "bounced", "sent", "replied"]);
  assert.equal(recentActivity(touches, 20).filter((event) => event.kind === "interested").length, 1);
  assert.equal(recentActivity(touches, 20).find((event) => event.at === "2026-10-06T14:00:00Z")?.followup, true);
});

test("the funnel counts each person once, at the furthest step", () => {
  assert.deepEqual(funnel(touches, "2026-10-01", dayOf, 1), { emailed: 4, replied: 2, interested: 1, meetings: 1 });
  assert.deepEqual(funnel(touches, "2026-10-07", dayOf, 0), { emailed: 2, replied: 0, interested: 0, meetings: 0 });
});
