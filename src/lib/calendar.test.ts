import assert from "node:assert/strict";
import test from "node:test";
import { matchProposedSlot } from "./calendar.ts";

const slots = [
  { start: "2025-10-21T14:00:00Z", end: "2025-10-21T14:30:00Z", label: "Tue, Oct 21, 10:00 AM EDT" },
  { start: "2025-10-22T17:00:00Z", end: "2025-10-22T17:30:00Z", label: "Wed, Oct 22, 1:00 PM EDT" },
];

test("books a slot the reply clearly names (weekday + date)", () => {
  const slot = matchProposedSlot("Tuesday the 21st works great for me", slots);
  assert.equal(slot?.start, "2025-10-21T14:00:00Z");
});

test("books on weekday + time", () => {
  const slot = matchProposedSlot("wednesday at 1:00 pm is perfect", slots);
  assert.equal(slot?.start, "2025-10-22T17:00:00Z");
});

test("an ambiguous yes books nothing", () => {
  assert.equal(matchProposedSlot("yes, sounds good — let's talk", slots), null);
});

test("a single weak cue is not enough", () => {
  assert.equal(matchProposedSlot("Tuesday maybe?", slots), null);
});
