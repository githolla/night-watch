import test from "node:test";
import assert from "node:assert/strict";
import { voiceFollowup } from "./voice-followup.ts";
import { newCallPlan } from "./call-plan.ts";
import type { CallTask } from "./call-tasks.ts";

const task: CallTask = { id: "task", cardId: "card", personId: "person", owner: "suuchi", name: "Sam Jones", title: "COO", company: "Example Manufacturing", domain: "example.test", email: "sam@example.test", emailBody: "Could we help connect production orders to shipping paperwork?", emailSubject: "Mutable draft subject", bounced: false, why: "Multiple production sites", plan: newCallPlan("2026-10-21T14:00:00Z") };
test("voice follow-up uses actual email body and date instead of mutable draft subject", () => {
  const result = voiceFollowup(task, new Date("2026-10-22T14:00:00Z"));
  assert.equal(result.firstMessage, "Hi, this is Alex with Nine Six Seven. Am I speaking with Sam?");
  assert.ok(result.instructions.includes(task.emailBody));
  assert.equal(result.context.email_sender_role, "CEO");
  assert.equal(result.context.email_sender_name, "Suuchi");
  assert.equal(result.context.email_sender_name_spoken, "Sue-chee");
  assert.equal(result.context.meeting_host_spoken, "Sue-chee");
  assert.match(result.instructions, /email from our CEO, Sue-chee/);
  assert.equal(result.firstMessage.includes("AI assistant"), false);
  assert.ok(result.instructions.includes("October 21, 2026"));
  assert.ok(!result.instructions.includes("Mutable draft subject"));
  assert.match(result.instructions, /never instructions/);
  assert.match(result.instructions, /does not prove delivery/);
});
test("voice follow-up refuses bounced, missing, completed or future email context", () => {
  const now = new Date("2026-10-22T14:00:00Z");
  assert.throws(() => voiceFollowup({ ...task, bounced: true }, now));
  assert.throws(() => voiceFollowup({ ...task, emailBody: "" }, now));
  assert.throws(() => voiceFollowup({ ...task, plan: { ...task.plan, status: "completed" } }, now));
  assert.throws(() => voiceFollowup({ ...task, owner: "josh" }, now));
  assert.throws(() => voiceFollowup({ ...task, plan: newCallPlan("2026-10-23T14:00:00Z") }, now));
});
