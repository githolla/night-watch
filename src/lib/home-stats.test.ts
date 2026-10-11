import assert from "node:assert/strict";
import test from "node:test";
import { dailySeries } from "./home-stats.ts";
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
