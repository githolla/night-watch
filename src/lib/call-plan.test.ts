import test from "node:test";
import assert from "node:assert/strict";
import { nextCallDate, dialHref, newCallPlan, readCallPlan } from "./call-plan.ts";
test("calls use the next Eastern business day at 10am, across weekends and DST", () => {
  assert.equal(nextCallDate("2026-10-14T14:30:00Z"), "2026-10-15T14:00:00.000Z");
  assert.equal(nextCallDate("2026-10-16T14:30:00Z"), "2026-10-19T14:00:00.000Z");
  assert.equal(nextCallDate("2026-10-31T01:30:00Z"), "2026-11-02T15:00:00.000Z");
  assert.equal(nextCallDate("2026-03-06T15:00:00Z"), "2026-03-09T14:00:00.000Z");
  assert.throws(() => nextCallDate("not a date"));
});
test("dial links accept published phone formats and extensions but reject injected links", () => {
  assert.equal(dialHref("+1 (800) 555-1234 ext 42"), "tel:+18005551234;ext=42");
  assert.equal(dialHref("javascript:alert(1)"), null);
  assert.equal(dialHref("1234"), null);
});
test("saved call plans round-trip and malformed data cannot become a call", () => {
  const plan = newCallPlan("2026-10-14T14:00:00Z");
  assert.deepEqual(readCallPlan(plan), plan);
  assert.equal(readCallPlan({ scheduledAt: "tomorrow" }), null);
});
