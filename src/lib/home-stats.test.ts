import assert from "node:assert/strict";
import test from "node:test";
import { batches, dailySeries, draftGroups, funnel, nextUp, type NextUpLead } from "./home-stats.ts";
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

test("the funnel counts each person once, at the furthest step", () => {
  assert.deepEqual(funnel(touches, "2026-10-01", dayOf, 1), { emailed: 4, replied: 2, interested: 1, meetings: 1 });
  assert.deepEqual(funnel(touches, "2026-10-07", dayOf, 0), { emailed: 2, replied: 0, interested: 0, meetings: 0 });
});

test("Next up lists every draft once, the send queue in order first", () => {
  const lead = (id: string, company: string, extra: Partial<NextUpLead> = {}): NextUpLead => ({
    id, name: `Person ${id}`, title: "CEO", company, subject: "Hi", body: "Hello", updatedAt: "2026-10-01T00:00:00Z", industry: "Construction", role: "Owner or CEO", size: "$10M to $50M", confirmed: false,
    group: "waiting", position: 0, time: null, reason: "Address not confirmed", ...extra,
  });
  const drafts = [lead("a", "Zeta"), lead("b", "Alpha"), lead("c", "Beta"), lead("d", "Gamma")];
  const queued = [lead("c", "Beta", { group: "later", position: 2 }), lead("d", "Gamma", { group: "going", position: 1, time: "9:05am" }), lead("e", "Kept Co", { group: "kept" })];
  assert.deepEqual(nextUp(drafts, queued).map((item) => `${item.id}:${item.group}`), ["d:going", "c:later", "e:kept", "b:waiting", "a:waiting"]);
});

test("drafts break into piles in review order, and piles into batches of ten", () => {
  const lead = (id: string, extra: Partial<NextUpLead>): NextUpLead => ({
    id, name: id, title: "", company: id, subject: "", body: "", updatedAt: "", industry: "Other", role: "", size: "", confirmed: true,
    group: "waiting", position: 0, time: null, reason: null, ...extra,
  });
  const leads = [
    lead("a", { group: "going", position: 1 }), lead("b", { group: "later", position: 41 }), lead("c", { reason: "Not in a window yet" }),
    lead("d", { reason: "Address not confirmed", confirmed: false }), lead("e", { reason: "No email address yet" }),
    lead("f", { group: "held", reason: "no usable email address" }), lead("g", { group: "held", reason: "Sent to this company this week" }), lead("h", { group: "kept" }),
  ];
  assert.deepEqual(draftGroups(leads).map((group) => `${group.key}:${group.leads.map((item) => item.id).join("")}`), ["next:a", "later:bc", "checking:d", "missing:ef", "held:gh"]);
  assert.deepEqual(batches(Array.from({ length: 23 }, (_, index) => index)).map((batch) => batch.length), [10, 10, 3]);
});
