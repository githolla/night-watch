import assert from "node:assert/strict";
import test from "node:test";
import type { AutoSendEmail } from "./autosend-view.ts";
import { todayRows, type BounceRow } from "./home-today.ts";
import type { ReplyItem } from "./replies-view.ts";
import type { SentTouch } from "./sent-stats.ts";

const dayStart = "2026-10-12T04:00:00.000Z";
const touch = (id: string, cardId: string, sentAt: string, extra: Partial<SentTouch> = {}): SentTouch => ({
  id, cardId, sentAt, replyAt: null, replyClass: null, bouncedAt: null, name: `Person ${cardId}`, title: "CEO", company: `Co ${cardId}`, domain: `${cardId}.com`, subject: "Hi",
  industry: "Pest control", role: "Owner or CEO", size: "$10M to $50M", ...extra,
});
const reply = (cardId: string, repliedAt: string, classification: string): ReplyItem => ({
  cardId, name: `Person ${cardId}`, title: "CEO", company: `Co ${cardId}`, domain: `${cardId}.com`, classification, repliedAt, snippet: "Sounds good", gmailUrl: "https://mail.google.com/x", group: "needs",
});
const bounce = (id: string, bouncedAt: string, fixed: boolean): BounceRow => ({
  id, card_id: `card-${id}`, person_id: `person-${id}`, sent_at: bouncedAt, bounced_at: bouncedAt,
  cards: { status: fixed ? "edited" : "sent", accounts: { name: `Co ${id}`, domain: `${id}.com` } },
  people: { full_name: `Person ${id}`, email: `p@${id}.com`, email_status: fixed ? "verified" : "invalid" },
});
const queued = { id: "q1", name: "Queued Person", company: "Queue Co", domain: "queue.com", subject: "Quick idea", status: "edited", time: "9:40 AM" } as AutoSendEmail;

test("today rows: only today's activity, follow-ups marked, outcomes and fixes shown", () => {
  const rows = todayRows({
    owner: "josh", dayStart,
    sent: [
      touch("a1", "a", "2026-10-05T14:00:00+00:00"),
      touch("a2", "a", "2026-10-12T13:00:00+00:00", { replyAt: "2026-10-12T15:00:00+00:00", replyClass: "positive" }),
      touch("b1", "b", "2026-10-12T13:05:00+00:00", { bouncedAt: "2026-10-12T13:06:00+00:00" }),
      touch("c1", "c", "2026-10-11T22:00:00+00:00"),
    ],
    replies: [reply("a", "2026-10-12T15:00:00+00:00", "positive"), reply("d", "2026-10-11T15:00:00+00:00", "neutral")],
    bounces: [bounce("b", "2026-10-12T13:06:00+00:00", false), bounce("e", "2026-10-12T05:00:00+00:00", true), bounce("f", "2026-10-10T05:00:00+00:00", false)],
    queue: [queued],
    linkedin: [
      { id: "l1", name: "Lin", company: "L Co", domain: "l.com", message: "hi", sentAt: "2026-10-12T14:00:00Z", channel: "linkedin_request" },
      { id: "l2", name: "Old", company: "O Co", message: "hi", sentAt: "2026-10-11T14:00:00Z", channel: "linkedin_message" },
    ],
  });

  assert.deepEqual(rows.sent.map((row) => [row.id, row.followup, row.tone]), [["a2", true, "good"], ["b1", false, "warn"]]);
  assert.match(rows.sent[0].note, /^Follow-up · Replied, interested$/);
  assert.match(rows.sent[1].note, /^First email: Hi · Bounced$/);
  assert.equal(rows.sent[0].href, "/outreach?list=josh&card=a");

  assert.deepEqual(rows.replies.map((row) => [row.name, row.tone, row.gmailUrl]), [["Person a", "good", "https://mail.google.com/x"]]);
  assert.match(rows.replies[0].note, /^Interested: “Sounds good”$/);

  assert.deepEqual(rows.bounces.map((row) => [row.id, Boolean(row.fix), row.tone]), [["b", true, "warn"], ["e", false, "plain"]]);
  assert.match(rows.bounces[1].note, /^Fixed: now p@e\.com, back in the queue$/);

  assert.deepEqual(rows.linkedin.map((row) => [row.id, row.note]), [["l1", "Connection request"]]);
  assert.deepEqual(rows.queue.map((row) => [row.id, row.time, row.note]), [["q1", "9:40 AM", "Quick idea · Not reviewed yet"]]);
});
