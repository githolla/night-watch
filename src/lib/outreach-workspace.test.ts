import test from "node:test";
import assert from "node:assert/strict";
import { outreachItems, outreachMetrics, type WorkspaceVoice } from "./outreach-workspace.ts";
import type { WorkspaceDraft, WorkspacePlan } from "./draft-workspace.ts";
import type { CallTask } from "./call-tasks.ts";

const draft: WorkspaceDraft = { id: "draft", updatedAt: "2026-10-29T12:00:00Z", status: "new", subject: "Order handoffs", body: "A real draft", name: "Morgan Lee", title: "COO", company: "Northstar", domain: "northstar.example", email: "morgan@example.com", confirmed: true, sendable: true, curated: false, held: false, industry: "Manufacturing", size: "$50M", linkedin: null, linkedinUrl: null, fit: null, trigger: null, sources: [], history: { sent: 0, last: null }, slot: { position: 1, label: "about 9:10am" } };
const plan: WorkspacePlan = { dayLabel: "Today", windowLabel: "9am to 11:30am ET", going: 2, dailyCap: 40, sentToday: 3, autoSend: true, blocker: null };
const voice: WorkspaceVoice = { id: "call", task_id: "task", status: "ended", destination: "+12015550100", created_at: "2026-10-28T13:00:00Z", scheduled_at: "2026-10-29T14:00:00Z", dispatched_at: "2026-10-29T14:00:00Z", ended_reason: "customer-ended-call", review_required: false, context_snapshot: { company_name: "Northstar", contact: { name: "Morgan Lee" } }, report: { operational: { outcome: "receptionist_reached" }, analysis: { summary: "Receptionist took a message.", reached_intended_person: false }, transcript: "User: I can take a message.\nAI: Please have Morgan call us." } };
const task: CallTask = { id: "task", cardId: "card", personId: "person", owner: "suuchi", name: "Morgan Lee", title: "COO", company: "Northstar", domain: "northstar.example", email: "morgan@example.com", emailBody: "Actual sent email", emailSubject: "Order handoffs", bounced: false, why: "Coordination", plan: { scheduledAt: "2026-10-29T14:00:00Z", firstEmailAt: "2026-10-28T13:00:00Z", status: "pending", phone: null, notes: "", outcome: null, completedAt: null, phoneSearchedAt: null } };
const base = { owner: "suuchi", drafts: [], plan, sent: [], voices: [], manual: [], linkedin: [], linkedinDone: [] };

test("55 drafts remain backlog unless actually in the enabled send window", () => {
  const drafts = Array.from({ length: 55 }, (_, index) => ({ ...draft, id: `draft-${index}`, slot: { position: index + 1, label: `Slot ${index + 1}` } }));
  const items = outreachItems({ ...base, drafts });
  assert.equal(items.filter(i => i.direction === "upcoming").length, 2);
  assert.equal(items.filter(i => i.direction === "backlog").length, 53);
  assert.equal(outreachItems({ ...base, drafts, plan: { ...plan, autoSend: false } }).filter(i => i.direction === "upcoming").length, 0);
  assert.equal(outreachItems({ ...base, drafts: [{ ...draft, held: true }, { ...draft, id: "missing", sendable: false }] }).filter(i => i.direction === "upcoming").length, 0);
});
test("automatic call assignments are not duplicated as pending manual calls", () => {
  const items = outreachItems({ ...base, voices: [voice], manual: [task] });
  assert.equal(items.length, 1); assert.equal(items[0].channel, "call");
  assert.equal(items[0].domain, task.domain); assert.equal(items[0].status, "Receptionist reached");
  assert.equal(items[0].reachedPerson, false);
  const manual = outreachItems({ ...base, manual: [task] });
  assert.equal(manual[0].direction, "backlog"); assert.equal(manual[0].at, null);
  assert.match(manual[0].summary, /not queued/);
});
test("scheduled timestamps and voicemail detections do not inflate completed metrics", () => {
  const queued = { ...voice, id: "queued", status: "queued", dispatched_at: null, report: null };
  const detected = { ...voice, id: "vm", ended_reason: "voicemail", report: { operational: { outcome: "voicemail" }, transcript: "AI: Thanks. Goodbye." } };
  const items = outreachItems({ ...base, voices: [queued, detected] });
  const metrics = outreachMetrics(items, "2026-10-29");
  assert.equal(metrics.calls, 1); assert.equal(metrics.voicemailMessages, 0);
  assert.equal(items.find(i => i.id === "voice:queued")?.direction, "upcoming");
  assert.equal(outreachMetrics(outreachItems({ ...base, voices: [{ ...voice, status: "active" }] }), "2026-10-29").calls, 1);
});
test("hang-ups are shown separately from conversation outcomes and dates use Eastern time", () => {
  const items = outreachItems({ ...base, voices: [{ ...voice, dispatched_at: "2026-10-29T02:00:00Z" }] });
  assert.equal(outreachMetrics(items, "2026-10-28").endedByRecipient, 1);
  assert.equal(outreachMetrics(items, "2026-10-28").receptionists, 1);
  assert.equal(outreachMetrics(items, "2026-10-29").calls, 0);
});
