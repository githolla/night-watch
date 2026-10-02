import assert from "node:assert/strict";
import test from "node:test";
import { buildFollowups, refreshLegacyFollowup } from "./followups.ts";

const ctx = { firstName: "Marc", company: "Eliassen", baseSubject: "automate instead of hire" };

test("email follow-ups: two steps, rising day offsets, threaded subject, personalized", () => {
  const steps = buildFollowups("email", ctx);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.day), [3, 10]);
  for (const step of steps) {
    assert.equal(step.channel, "email");
    assert.equal(step.subject, "Re: automate instead of hire");
    assert.match(step.body, /Marc/);
  }
  assert.match(steps.map((s) => s.body).join(" "), /Eliassen/);
});

test("linkedin follow-ups: two steps, no subject line, personalized", () => {
  const steps = buildFollowups("linkedin_message", ctx);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.day), [3, 10]);
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

test("with a task and metric, each follow-up names the task with one question and no long dash", () => {
  const named = { ...ctx, task: "branch service follow-up", metric: "time spent chasing updates" };
  for (const channel of ["email", "linkedin_message"] as const) {
    const steps = buildFollowups(channel, named);
    assert.deepEqual(steps.map((s) => s.day), [3, 10]);
    for (const step of steps) {
      assert.match(step.body, /branch service follow-up/);
      assert.equal((step.body.match(/\?/g) ?? []).length, 1);
      assert.ok(step.body.trim().endsWith("?"));
      assert.doesNotMatch(step.body, /[—–]/);
    }
    assert.match(steps[0].body, /Following up on branch service follow-up for Eliassen\. A first version would be judged on one number: time spent chasing updates\./);
    assert.match(steps[1].body, /leave this with you/);
  }
});

test("without both task and metric, follow-ups are exactly the generic wording", () => {
  const generic = buildFollowups("email", ctx);
  assert.deepEqual(buildFollowups("email", { ...ctx, task: "branch service follow-up" }), generic);
  assert.deepEqual(buildFollowups("email", { ...ctx, metric: "time spent chasing updates" }), generic);
  assert.deepEqual(buildFollowups("email", { ...ctx, task: "is it slow?", metric: "time spent" }), generic, "an unsafe task is ignored");
  assert.equal(generic[0].body, "Hi Marc,\n\nFollowing up on the project I suggested for Eliassen. We'd work with the people doing the task, build a first version and test whether it saves them time.\n\nIs this a task your team would like help with?");
  assert.equal(generic[1].body, "Hi Marc,\n\nI'll leave this with you after this note. If the project in my first message becomes a priority at Eliassen, our AI engineers can work alongside your team from the first build through testing and training.\n\nWould it be better to revisit this later?");
});

test("legacy follow-up text still maps to the current generic wording", () => {
  const legacy = refreshLegacyFollowup("Floating this back up in case it slipped by", { ...ctx, step: 1, channel: "email" });
  assert.equal(legacy, buildFollowups("email", ctx)[0].body);
  assert.equal(refreshLegacyFollowup("A personal note.", { ...ctx, step: 1, channel: "email" }), "A personal note.");
});
