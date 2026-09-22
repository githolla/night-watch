import assert from "node:assert/strict";
import test from "node:test";
import { dailyCap, sendDayStart } from "./send-guards.ts";

test("the warm-up reaches the full cap in about a week, not a month", () => {
  // The ramp used to add 1/day, so raising the base to 40 would have changed almost nothing for 36 days.
  const base = 40, step = 5;
  assert.equal(dailyCap(0, base, step), 5, "day one is deliberately small");
  assert.equal(dailyCap(1, base, step), 10);
  assert.equal(dailyCap(3, base, step), 20);
  assert.equal(dailyCap(7, base, step), 40, "full volume within a week");
  assert.equal(dailyCap(60, base, step), 40, "never exceeds the base");
  // A nonsense number of days can never produce a nonsense cap.
  assert.equal(dailyCap(-5, base, step), 5);
  assert.ok(dailyCap(0, 1, step) >= 1, "always at least one send");
});

test("the daily window turns over at the operator's midnight, not the server's", () => {
  // 01:30 UTC on 22 Sep is still 21:30 on 21 Sep in New York, so the window must be the 21st — the bug was
  // that a US evening session got a second full day's quota at 8pm.
  const evening = new Date("2026-09-22T01:30:00Z");
  const start = sendDayStart(evening, "America/New_York");
  assert.equal(start.toISOString(), "2026-09-21T04:00:00.000Z", "midnight ET on the 21st");
  assert.ok(start < evening, "the window has already begun");
  assert.ok(evening.getTime() - start.getTime() < 36 * 3600_000, "and is less than a day and a half long");

  // Just after midnight ET the window moves on.
  const afterMidnight = new Date("2026-09-22T04:30:00Z");
  assert.equal(sendDayStart(afterMidnight, "America/New_York").toISOString(), "2026-09-22T04:00:00.000Z");

  // UTC still behaves as UTC, and an unknown zone falls back rather than throwing mid-send.
  assert.equal(sendDayStart(evening, "UTC").toISOString(), "2026-09-22T00:00:00.000Z");
  assert.doesNotThrow(() => sendDayStart(evening, "Not/AZone"));
});
