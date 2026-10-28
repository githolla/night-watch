import test from "node:test";
import assert from "node:assert/strict";
import { activityAnalytics, activityDayWindow, activitySlackText, type ActivityCall, type ActivityTouch } from "./activity-analytics.ts";
import { directoryDigits } from "./phone-directory.ts";

test("report days follow Eastern midnight and daylight saving transitions", () => {
  assert.deepEqual(activityDayWindow("2026-11-01"), { start: "2026-11-01T04:00:00.000Z", end: "2026-11-02T05:00:00.000Z" });
  assert.deepEqual(activityDayWindow("2026-03-08"), { start: "2026-03-08T05:00:00.000Z", end: "2026-03-09T04:00:00.000Z" });
  assert.throws(() => activityDayWindow("2026-02-31"));
});
test("emails use send dates while replies and bounces use their own event dates", () => {
  const touch: ActivityTouch = { id: "sent", person_id: "person", sent_by: "josh", sent_at: "2026-10-27T23:00:00Z", reply_at: "2026-10-28T15:00:00Z", bounced_at: null, reply_classification: "interested" };
  const stats = activityAnalytics([touch, { ...touch, id: "other", reply_classification: "ooo", person_id: "ooo" }, { ...touch, id: "bounce", reply_at: null, bounced_at: "2026-10-28T13:00:00Z" }], [], "2026-10-28");
  assert.equal(stats[0].emailsSent, 0); assert.equal(stats[0].replies, 1); assert.equal(stats[0].bounces, 1);
  assert.equal(stats[1].replies, 0);
});
test("test calls, undialed queues and voicemail detections do not inflate call or message counts", () => {
  const call: ActivityCall = { id: "one", owner: "suuchi", mode: "pilot", status: "ended", dispatched_at: "2026-10-28T13:00:00Z", review_required: false, report: { operational: { outcome: "voicemail" }, transcript: "User: Leave a message.\nAI: Thanks. Goodbye." } };
  const calls = [call, { ...call, id: "test", mode: "internal" }, { ...call, id: "queue", dispatched_at: null, status: "queued" }, { ...call, id: "message", report: { operational: { outcome: "voicemail" }, transcript: "AI: Hi, please reply to our email or call us." } }, { ...call, id: "booking", report: { analysis: { outcome: "meeting_booked" }, operational: { outcome: null } } }];
  const stats = activityAnalytics([], calls, "2026-10-28");
  assert.equal(stats[1].callsMade, 3); assert.equal(stats[1].queued, 1); assert.equal(stats[1].voicemailReached, 2); assert.equal(stats[1].voicemailMessagesAttempted, 1); assert.equal(stats[1].meetingsConfirmed, 0);
  assert.match(activitySlackText(stats, "2026-10-28", "https://example.com"), /not confirmed recordings/);
});
test("dial by name handles standard keypad letters, accents and apostrophes", () => {
  assert.equal(directoryDigits("Keller"), "535537"); assert.equal(directoryDigits("O’Néil"), "66345"); assert.equal(directoryDigits("123"), null);
});
