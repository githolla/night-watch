import type { WorkspaceDraft, WorkspacePlan } from "./draft-workspace.ts";
import type { SentTouch } from "./sent-stats.ts";
import type { CallTask } from "./call-tasks.ts";
import type { LinkedInTask, LinkedInDone } from "./linkedin-task-list.ts";
import { localParts } from "./local-time.ts";
import { formatCallPhone } from "./call-plan.ts";

export type OutreachChannel = "email" | "call" | "linkedin";
export type OutreachItem = {
  id: string; channel: OutreachChannel; direction: "upcoming" | "history" | "backlog";
  person: string; company: string; domain: string; at: string | null; timing: string;
  status: string; tone: "good" | "warn" | "neutral"; attention: boolean;
  subject: string; summary: string; body: string; transcript: string; address: string;
  href: string; action: string; outcome: string | null; endReason: string | null;
  automatic: boolean; started: boolean; reachedPerson: boolean; voicemailAttempted: boolean;
};
export type WorkspaceVoice = { id: string; task_id: string | null; status: string; destination: string; created_at: string; scheduled_at: string | null; dispatched_at: string | null; ended_reason: string | null; review_required: boolean; context_snapshot: Record<string, unknown>; report: unknown };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const label: Record<string, string> = { meeting_booked: "Meeting booked", interested_followup: "Follow-up requested", callback_requested: "Callback requested", receptionist_reached: "Receptionist reached", phone_menu_unresolved: "Switchboard blocked", voicemail: "Voicemail reached", no_answer: "No answer", technical_failure: "Technical issue", not_interested: "Not interested", do_not_contact: "Opted out", wrong_number: "Wrong number", referral: "Referral", connected: "Connected" };
const blank = { at: null, timing: "", summary: "", body: "", transcript: "", address: "", outcome: null, endReason: null, automatic: false, started: false, reachedPerson: false, voicemailAttempted: false };
export function outreachItems(input: { owner: string; drafts: WorkspaceDraft[]; plan: WorkspacePlan | null; sent: SentTouch[]; voices: WorkspaceVoice[]; manual: CallTask[]; linkedin: LinkedInTask[]; linkedinDone: LinkedInDone[] }): OutreachItem[] {
  const { owner, plan } = input;
  const items: OutreachItem[] = input.drafts.map(d => {
    const scheduled = Boolean(plan?.autoSend && !d.held && d.sendable && d.slot && !d.slot.label.startsWith("Held:") && d.slot.position <= plan.going);
    const attention = !d.sendable || d.slot?.label.startsWith("Held:") === true;
    return { ...blank, id: `draft:${d.id}`, channel: "email", direction: scheduled ? "upcoming" : "backlog", person: d.name, company: d.company, domain: d.domain, status: scheduled ? "Scheduled" : d.held ? "Held by you" : !d.sendable ? "Needs address" : attention ? "Blocked" : "Draft", tone: attention ? "warn" : "neutral", attention, subject: d.subject, body: d.body, address: d.email ?? "", timing: scheduled ? `${plan?.dayLabel} · ${d.slot?.label}` : "Not scheduled", summary: attention ? d.slot?.label ?? "Add a usable address to continue." : scheduled ? plan?.windowLabel ?? "" : d.held ? "Kept out of automatic sending." : plan?.blocker ?? "Draft backlog, outside the next send window.", href: `/drafts?owner=${owner}#review`, action: "Open email workspace", automatic: scheduled };
  });
  for (const sent of input.sent) items.push({ ...blank, id: `email:${sent.id}`, channel: "email", direction: "history", person: sent.name, company: sent.company, domain: sent.domain ?? "", at: sent.sentAt, status: sent.bouncedAt ? "Bounced" : sent.replyAt && sent.replyClass !== "ooo" ? "Replied" : "Sent", tone: sent.bouncedAt ? "warn" : "good", attention: Boolean(sent.bouncedAt), subject: sent.subject, address: sent.email ?? "", summary: sent.bouncedAt ? "Delivery failed. Review the address before further outreach." : sent.replyAt ? "A reply was recorded. Review the conversation before following up." : "Sent through Gmail. Inbox placement and reading are not confirmed.", href: `/drafts/sent?owner=${owner}&days=7`, action: "Open email history" });
  const automatedTasks = new Set(input.voices.map(v => v.task_id).filter(Boolean));
  for (const voice of input.voices) {
    const linkedTask = input.manual.find(task => task.id === voice.task_id);
    const report = record(voice.report), analysis = record(report.analysis), operational = record(report.operational), context = voice.context_snapshot, contact = record(context.contact), company = record(context.company);
    const outcome = text(operational.outcome) || null, transcript = text(report.transcript);
    const upcoming = ["queued", "creating", "active"].includes(voice.status);
    const attention = voice.review_required || ["held", "technical_failure", "phone_menu_unresolved", "wrong_number"].includes(outcome ?? voice.status);
    const voicemailAttempted = outcome === "voicemail" && /^(?:AI|Alex):\s*.+(?:callback|call|reply|email)/im.test(transcript);
    items.push({ ...blank, id: `voice:${voice.id}`, channel: "call", direction: upcoming ? "upcoming" : voice.dispatched_at ? "history" : "backlog", person: text(contact.name) || text(context.full_name) || "Contact", company: text(context.company_name) || text(company.name) || "Company", domain: text(company.domain) || text(context.domain) || text(context.company_domain) || linkedTask?.domain || "", at: voice.dispatched_at ?? (upcoming ? voice.scheduled_at : null), timing: upcoming ? "Recipient’s local calling window applies" : "", status: voice.status === "active" || voice.status === "creating" ? "In progress" : voice.status === "queued" ? "Scheduled" : voice.status === "held" ? "Held for review" : voice.status === "cancelled" ? "Cancelled" : outcome === "voicemail" && voicemailAttempted ? "VM message attempted" : label[outcome ?? ""] ?? "Call ended", tone: attention ? "warn" : ["meeting_booked", "receptionist_reached", "interested_followup"].includes(outcome ?? "") ? "good" : "neutral", attention, subject: text(context.email_subject), body: text(context.email_body), transcript, address: formatCallPhone(voice.destination), summary: text(analysis.summary) || (upcoming ? "Alex will refresh email, reply and suppression checks before dialing." : "The call ended without a complete outcome report."), href: `/calls?owner=${owner}`, action: "Open call workspace", outcome, endReason: voice.ended_reason, automatic: true, started: Boolean(voice.dispatched_at), reachedPerson: analysis.reached_intended_person === true, voicemailAttempted });
  }
  for (const task of input.manual.filter(t => !automatedTasks.has(t.id))) {
    const pending = task.plan.status === "pending";
    items.push({ ...blank, id: `manual:${task.id}`, channel: "call", direction: pending ? "backlog" : "history", person: task.name, company: task.company, domain: task.domain, at: pending ? null : task.plan.completedAt, status: pending ? task.plan.phone ? "Manual follow-up" : "Needs phone number" : label[task.plan.outcome ?? ""] ?? "Completed manually", tone: pending && !task.plan.phone ? "warn" : "neutral", attention: pending && !task.plan.phone, subject: task.emailSubject, body: task.emailBody, summary: pending ? "Call prep task only. This is not queued for Alex to dial." : task.plan.notes, started: !pending && task.plan.status === "completed", address: task.plan.phone ? formatCallPhone(task.plan.phone.number) : "No phone saved", href: `/calls?owner=${owner}&taskId=${task.id}#manual-calls`, action: "Open call prep", outcome: task.plan.outcome });
  }
  for (const task of input.linkedin) items.push({ ...blank, id: `linkedin:${task.key}`, channel: "linkedin", direction: "backlog", person: task.name, company: task.company, domain: task.domain, timing: "Manual send", status: task.kind === "followup" ? "Follow-up due" : "Ready to send manually", tone: "neutral", attention: false, subject: task.subject ?? "LinkedIn message", body: task.message, summary: "Copy the message, send it in LinkedIn, then mark it sent. Nothing sends automatically.", href: `/linkedin?owner=${owner}`, action: "Open LinkedIn tasks" });
  for (const done of input.linkedinDone) items.push({ ...blank, id: `linkedin-sent:${done.id}`, channel: "linkedin", direction: "history", person: done.name, company: done.company, domain: done.domain ?? "", at: done.sentAt, status: "Marked sent", tone: "good", attention: false, subject: "LinkedIn message", body: done.message, summary: "Recorded as sent manually. LinkedIn delivery is not independently confirmed.", href: `/linkedin?owner=${owner}`, action: "Open LinkedIn history" });
  return items;
}
export function outreachMetrics(items: OutreachItem[], day: string | null) {
  const history = items.filter(i => i.direction === "history" && i.at && (!day || localParts(new Date(i.at), "America/New_York").date === day));
  const madeCalls = items.filter(i => i.channel === "call" && i.at && (i.direction === "history" || i.started) && (!day || localParts(new Date(i.at), "America/New_York").date === day));
  return { emails: history.filter(i => i.channel === "email").length, repliedEmails: history.filter(i => i.channel === "email" && i.status === "Replied").length, bouncedEmails: history.filter(i => i.channel === "email" && i.status === "Bounced").length, calls: madeCalls.length, voicemailMessages: history.filter(i => i.voicemailAttempted).length, endedByRecipient: history.filter(i => i.endReason === "customer-ended-call").length, receptionists: history.filter(i => i.outcome === "receptionist_reached").length, reached: history.filter(i => i.reachedPerson || i.outcome === "connected").length, blocked: history.filter(i => i.outcome === "phone_menu_unresolved").length, meetings: history.filter(i => i.outcome === "meeting_booked").length, linkedin: history.filter(i => i.channel === "linkedin").length };
}
