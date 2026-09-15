import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowups } from "./followups.ts";

const ctx = { firstName: "Marc", company: "Eliassen", baseSubject: "automate instead of hire" };

test("email follow-ups: three steps, rising day offsets, threaded subject, personalized", () => {
  const steps = buildFollowups("email", ctx);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.day), [3, 7, 14]);
  for (const step of steps) {
    assert.equal(step.channel, "email");
    assert.equal(step.subject, "Re: automate instead of hire");
    assert.match(step.body, /Marc/);
  }
  assert.match(steps.map((s) => s.body).join(" "), /Eliassen/);
});

test("linkedin follow-ups: three steps, no subject line, personalized", () => {
  const steps = buildFollowups("linkedin_message", ctx);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps.map((s) => s.day), [3, 7, 14]);
  for (const step of steps) {
    assert.equal(step.channel, "linkedin_message");
    assert.equal(step.subject, null);
    assert.match(step.body, /Marc/);
  }
});

test("missing name/company fall back to safe wording", () => {
  const steps = buildFollowups("email", { firstName: "", company: "", baseSubject: "" });
  assert.match(steps[0].body, /Hi there,/);
  assert.match(steps[0].subject ?? "", /Following up/);
});
