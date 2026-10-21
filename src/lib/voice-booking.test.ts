import test from "node:test";
import assert from "node:assert/strict";
import { voiceSlotAllowed, voiceSlotClear } from "./voice-booking.ts";

test("meetings must finish inside each day's preferred hours", () => {
  assert.equal(voiceSlotAllowed("2026-10-26T17:30:00-04:00", "2026-10-26T18:00:00-04:00"), true);
  assert.equal(voiceSlotAllowed("2026-10-27T16:15:00-04:00", "2026-10-27T16:45:00-04:00"), false);
  assert.equal(voiceSlotAllowed("2026-10-28T15:30:00-04:00", "2026-10-28T16:00:00-04:00"), true);
  assert.equal(voiceSlotAllowed("2026-10-30T16:00:00-04:00", "2026-10-30T16:30:00-04:00"), false);
});
test("Thursday pickup cannot be overridden by a requested exception", () => {
  assert.equal(voiceSlotAllowed("2026-10-29T14:45:00-04:00", "2026-10-29T15:15:00-04:00", true), false);
  assert.equal(voiceSlotAllowed("2026-10-29T15:30:00-04:00", "2026-10-29T16:00:00-04:00", true), false);
  assert.equal(voiceSlotAllowed("2026-10-29T16:00:00-04:00", "2026-10-29T16:30:00-04:00"), true);
});
test("weekends require an explicit prospect request", () => {
  assert.equal(voiceSlotAllowed("2026-10-24T10:00:00-04:00", "2026-10-24T10:30:00-04:00"), false);
  assert.equal(voiceSlotAllowed("2026-10-24T10:00:00-04:00", "2026-10-24T10:30:00-04:00", true), true);
});
test("Eastern hours follow daylight saving time", () => {
  assert.equal(voiceSlotAllowed("2026-11-02T13:00:00Z", "2026-11-02T13:30:00Z"), true);
  assert.equal(voiceSlotAllowed("2026-11-02T12:00:00Z", "2026-11-02T12:30:00Z"), false);
});
test("invalid durations and meetings crossing midnight are rejected", () => {
  assert.equal(voiceSlotAllowed("bad", "bad", true), false);
  assert.equal(voiceSlotAllowed("2026-10-26T10:00:00-04:00", "2026-10-26T10:15:00-04:00", true), false);
  assert.equal(voiceSlotAllowed("2026-10-26T23:45:00-04:00", "2026-10-27T00:15:00-04:00", true), false);
});
test("calendar conflicts include fifteen minutes on both sides", () => {
  const start = "2026-10-26T14:00:00Z", end = "2026-10-26T14:30:00Z";
  assert.equal(voiceSlotClear(start, end, [[Date.parse("2026-10-26T13:30:00Z"), Date.parse("2026-10-26T13:46:00Z")]]), false);
  assert.equal(voiceSlotClear(start, end, [[Date.parse("2026-10-26T14:44:00Z"), Date.parse("2026-10-26T15:00:00Z")]]), false);
  assert.equal(voiceSlotClear(start, end, [[Date.parse("2026-10-26T14:45:00Z"), Date.parse("2026-10-26T15:00:00Z")]]), true);
});
