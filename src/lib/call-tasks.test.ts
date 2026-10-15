import test from "node:test";
import assert from "node:assert/strict";
import { buildCallTasks, updateCallPlan } from "./call-tasks.ts";
import { newCallPlan } from "./call-plan.ts";
import { memoryDb } from "./testing/memory-db.ts";
const row = { id: "cadence", card_id: "card", person_id: "person", owner: "josh" as const, status: "active", rules: {}, people: { full_name: "Sam Smith", title: "CEO", phone: null, email: "sam@acme.test", do_not_contact: false }, cards: { status: "sent", why_now: "Hiring", email_subject: "A project", accounts: { name: "Acme", domain: "acme.test", status: "active" } } };
const touch = { card_id: "card", person_id: "person", sent_by: "josh" as const, sent_at: "2026-10-14T14:00:00Z", body: "Actual email", reply_at: null, reply_classification: null, bounced_at: null };
test("a call requires an actual first email and keeps its real body and date", () => {
  assert.equal(buildCallTasks([row], []).length, 0);
  const tasks = buildCallTasks([row], [touch, { ...touch, sent_at: "2026-10-17T14:00:00Z", body: "Followup" }]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].emailBody, "Actual email");
  assert.equal(tasks[0].plan.scheduledAt, "2026-10-15T14:00:00.000Z");
  assert.equal(buildCallTasks([row], [{ ...touch, person_id: "other" }]).length, 0);
});
test("replies, opt-outs and inactive companies exclude cold calls; OOO does not", () => {
  assert.equal(buildCallTasks([row], [{ ...touch, reply_at: touch.sent_at, reply_classification: "neutral" }]).length, 0);
  assert.equal(buildCallTasks([row], [{ ...touch, reply_at: touch.sent_at, reply_classification: "ooo" }]).length, 1);
  assert.equal(buildCallTasks([{ ...row, people: { ...row.people, do_not_contact: true } }], [touch]).length, 0);
  assert.equal(buildCallTasks([{ ...row, cards: { ...row.cards, accounts: { ...row.cards.accounts, status: "client" } } }], [touch]).length, 0);
});
test("multiple cards for the same contact do not produce duplicate calls", () => {
  assert.equal(buildCallTasks([row, { ...row, id: "second" }], [touch]).length, 1);
});
test("bounced first emails and subsequent bounces remove the email follow-up call", () => {
  assert.equal(buildCallTasks([row], [{ ...touch, bounced_at: touch.sent_at }]).length, 0);
  assert.equal(buildCallTasks([row], [touch, { ...touch, sent_at: "2026-10-16T14:00:00Z", bounced_at: "2026-10-16T14:01:00Z" }]).length, 0);
  const saved = { ...row, rules: { call: { ...newCallPlan(touch.sent_at), phone: { number: "3235550100", kind: "company", sourceUrl: "https://acme.test", checkedAt: touch.sent_at, notes: "" } } } };
  assert.equal(buildCallTasks([saved], [{ ...touch, bounced_at: touch.sent_at }]).length, 0);
  assert.equal(buildCallTasks([row], [touch]).length, 1);
});
test("saved call plans cannot replace the actual first-email timestamp", () => {
  const plan = newCallPlan("2026-10-01T14:00:00Z");
  const task = buildCallTasks([{ ...row, rules: { call: plan } }], [touch])[0];
  assert.equal(task.plan.firstEmailAt, "2026-10-14T14:00:00.000Z");
  assert.equal(task.plan.scheduledAt, plan.scheduledAt);
});
test("call edits preserve sequence rules and recorded outcomes", async () => {
  const plan = newCallPlan(touch.sent_at);
  const h = memoryDb({ cadences: [{ id: "cadence", status: "active", updated_at: "v1", rules: { stop_on_reply: true, enrollment_steps: [{ body: "Personal followup" }], call: plan } }] });
  await updateCallPlan(h.db, "cadence", current => ({ ...current!, notes: "Discuss their current tools" }));
  const rules = h.tables.cadences[0].rules as { stop_on_reply: boolean; enrollment_steps: { body: string }[]; call: { notes: string } };
  assert.equal(rules.stop_on_reply, true);
  assert.equal(rules.enrollment_steps[0].body, "Personal followup");
  assert.equal(rules.call.notes, "Discuss their current tools");
});
