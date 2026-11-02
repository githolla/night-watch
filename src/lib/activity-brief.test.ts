import test from "node:test";
import assert from "node:assert/strict";
import { activityAnalytics } from "./activity-analytics.ts";
import { activityBriefDates, activityBriefSlack, type ActivityBrief } from "./activity-brief.ts";

test("last week is the previous Monday to Sunday across the fall clock change", () => {
  const monday = activityBriefDates("2026-11-02");
  assert.equal(monday.weekStart, "2026-10-26");
  assert.equal(monday.weekEnd, "2026-11-02");
  assert.equal(monday.yesterday, "2026-11-01");
  assert.equal(activityBriefDates("2026-11-05").weekStart, "2026-10-26");
  assert.equal(activityBriefDates("2026-11-01").weekStart, "2026-10-19");
});
test("Slack briefing separates period activity, due work, controls and actual queued calls", () => {
  const stats = activityAnalytics([], [], "2026-11-02");
  const brief: ActivityBrief = {
    day: "2026-11-02", generatedAt: "2026-11-02T15:00:00Z", weekStart: "2026-10-26", weekEnd: "2026-11-02",
    lastWeek: stats, yesterday: stats, today: stats,
    schedule: Array.from({ length: 7 }, (_, i) => ["josh", "suuchi"].map(owner => ({ date: `2026-11-0${i + 2}`, owner, emailFollowups: 46, calls: 10 }))).flat(),
    overdueEmails: 3, overdueCalls: 2, failedEmails: 1, controls: [{ owner: "josh", blocker: "Auto-send is paused", dailyCap: 40, newEmails: 0, newEmailDay: "2026-11-02", held: 2 }], callEnabled: true, callDailyLimit: 20,
  };
  const message = activityBriefSlack(brief, "https://example.com");
  assert.match(message.text, /TODAY SO FAR/);
  assert.match(message.text, /YESTERDAY/);
  assert.match(message.text, /LAST WEEK/);
  assert.match(message.text, /46 email follow-ups due/);
  assert.match(message.text, /Auto-send is paused/);
  assert.match(message.text, /3 overdue email steps/);
  assert.match(message.text, /before daily limits/);
  assert.match(message.text, /not confirmed recordings/);
  assert.ok(message.blocks.length < 50);
  for (const block of message.blocks) {
    if (block.type === "section") {
      const text = block.text as { text: string };
      assert.ok(text.text.length <= 3000);
    }
  }
});
