import test from "node:test";
import assert from "node:assert/strict";
import { catchupCallAt } from "./call-queue-scheduling.ts";
test("old email calls enter the next company-local business window and fresh calls keep their due date", () => {
  const night = new Date("2026-10-30T03:00:00Z");
  assert.equal(catchupCallAt("2026-10-15T14:00:00Z", "America/New_York", 0, night), "2026-10-30T14:00:00.000Z");
  assert.equal(catchupCallAt("2026-10-15T14:00:00Z", "America/Los_Angeles", 1, night), "2026-10-30T17:01:00.000Z");
  assert.equal(catchupCallAt("2026-11-02T15:00:00Z", "America/New_York", 0, night), "2026-11-02T15:00:00Z");
  assert.equal(catchupCallAt("2026-10-15T14:00:00Z", "America/New_York", 0, new Date("2026-10-31T15:00:00Z")), "2026-11-02T15:00:00.000Z");
});
