import test from "node:test";
import assert from "node:assert/strict";
import { nextCallDate, dialHref, formatCallPhone, newCallPlan, readCallPlan } from "./call-plan.ts";

test("call numbers share one display format while preserving extensions and international prefixes", () => {
  for (const number of ["3235550199", "+1 323 555 0199", "1 (323) 555-0199", "323.555.0199"]) assert.equal(formatCallPhone(number), "(323) 555-0199");
  assert.equal(formatCallPhone("5867496900 ext 232"), "(586) 749-6900 ext. 232");
  assert.equal(formatCallPhone("+44 20 7946 0958"), "+442079460958");
  for (const number of [null, undefined, "", "none", "javascript:alert(1)"]) assert.equal(formatCallPhone(number), "Not available");
  assert.equal(dialHref("+1 323 555 0199"), "tel:+13235550199");
});
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

test("Supabase offset timestamps preserve saved phone evidence and call outcomes", () => {
  const plan = newCallPlan("2026-10-14T14:00:00+00:00");
  assert.equal(plan.firstEmailAt, "2026-10-14T14:00:00.000Z");
  const saved = { ...plan, firstEmailAt: "2026-10-14T14:00:00+00:00", phone: { number: "8005551234", kind: "company", sourceUrl: "https://acme.test/contact", checkedAt: "2026-10-14T14:00:00Z", notes: "Main line" } };
  assert.equal(readCallPlan(saved)?.phone?.number, "8005551234");
});
