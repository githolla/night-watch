import test from "node:test";
import assert from "node:assert/strict";
import { voiceFollowup } from "./voice-followup.ts";
import { newCallPlan } from "./call-plan.ts";
import { VOICE_BOOKING } from "./voice-booking.ts";
import type { CallTask } from "./call-tasks.ts";

const task: CallTask = { id: "task", cardId: "card", personId: "person", owner: "suuchi", name: "Sam Jones", title: "COO", company: "Example Manufacturing", domain: "example.test", email: "sam@example.test", emailBody: "Could we help connect production orders to shipping paperwork?", emailSubject: "Mutable draft subject", bounced: false, why: "Multiple production sites", plan: newCallPlan("2026-10-21T14:00:00Z") };
test("voice follow-up uses actual email body and date instead of mutable draft subject", () => {
  const result = voiceFollowup(task, new Date("2026-10-22T14:00:00Z"));
  assert.equal(result.firstMessage, "Hi, this is Alex with Nine Six Seven. Am I speaking with Sam?");
  assert.ok(result.instructions.includes(task.emailBody));
  assert.equal(result.context.email_sender_role, null);
  assert.equal(result.context.email_sender_name, "Suuchi");
  assert.equal(result.context.email_sender_name_spoken, "Nine Six Seven");
  assert.equal(result.context.meeting_host_spoken, "our executive team");
  assert.match(result.instructions, /email from Nine Six Seven/);
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

  assert.throws(() => voiceFollowup({ ...task, plan: newCallPlan("2026-10-23T14:00:00Z") }, now));
});

test("reception message includes the real callback number without exposing email details", () => {
  const result = voiceFollowup({ ...task, plan: { ...task.plan, phone: { number: "+15555550100", kind: "company", sourceUrl: "https://example.test/contact", checkedAt: "2026-10-21T14:00:00Z", notes: "Office" } } }, new Date("2026-10-22T14:00:00Z"));
  assert.equal(result.context.callback_number, VOICE_BOOKING.callerNumber);
  assert.equal(result.context.gatekeeper_message, "Sure. Please let Sam know Alex with Nine Six Seven called. The callback number is two zero one, five eight one, four three zero nine.");
  assert.doesNotMatch(result.context.gatekeeper_message, /production|shipping|email|fifteen|meeting|workflow/i);
  assert.match(result.instructions, /including its callback number, then pause for acknowledgement/);
  assert.match(result.instructions, /Only after confirming you reached Sam Jones/);
});

test("both owners retain their actual sender identity and the shared executive calendar", () => {
  for (const owner of ["josh", "suuchi"] as const) {
    const senderName = owner === "josh" ? "Josh Lee" : "Suuchi Ramesh";
    const result = voiceFollowup({ ...task, owner }, new Date("2026-10-22T14:00:00Z"), { senderName, senderTitle: "Founder", senderAddress: `${owner}@example.test`, subject: `${owner} sent this` });
    assert.equal(result.context.email_sender_name, senderName);
    assert.equal(result.context.email_sender_role, "Founder");
    assert.equal(result.context.prior_interactions[0].sender, senderName);
    assert.equal(result.context.sentEmail.sender, senderName);
    assert.equal(result.context.email_sender_address, `${owner}@example.test`);
    assert.equal(result.context.email_subject, `${owner} sent this`);
    assert.equal(result.context.meeting_host, "Suuchi");
  }
});
