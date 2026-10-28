import { localParts } from "./local-time.ts";

export type ActivityTouch = { id: string; person_id: string | null; sent_by: string; sent_at: string | null; reply_at: string | null; bounced_at: string | null; reply_classification: string | null };
export type ActivityCall = { id: string; owner: string; mode: string; status: string; dispatched_at: string | null; review_required: boolean; report: unknown };
const seats = ["josh", "suuchi"] as const;
const onDay = (at: string | null, day: string) => Boolean(at && Number.isFinite(Date.parse(at)) && localParts(new Date(at), "America/New_York").date === day);
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function activityDayWindow(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Use a YYYY-MM-DD report date.");
  const midnight = (date: Date) => {
    const target = date.getTime();
    let guess = target;
    for (let i = 0; i < 3; i++) {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(guess)).map(p => [p.type, p.value]));
      guess += target - Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    }
    return new Date(guess).toISOString();
  };
  const date = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Invalid report date.");
  return { start: midnight(date), end: midnight(new Date(date.getTime() + 86400000)) };
}

export function activityAnalytics(touches: ActivityTouch[], calls: ActivityCall[], day: string) {
  return seats.map(owner => {
    const sent = touches.filter(t => t.sent_by === owner && onDay(t.sent_at, day));
    const replies = touches.filter(t => t.sent_by === owner && onDay(t.reply_at, day) && !["ooo", "none"].includes(t.reply_classification ?? "none"));
    const bounces = touches.filter(t => t.sent_by === owner && onDay(t.bounced_at, day));
    const live = calls.filter(c => c.owner === owner && c.mode === "pilot");
    const made = live.filter(c => onDay(c.dispatched_at, day));
    const outcomes = made.map(c => ({ ...c, operational: record(record(c.report).operational), analysis: record(record(c.report).analysis), transcript: record(c.report).transcript }));
    const count = (outcome: string) => outcomes.filter(c => c.operational.outcome === outcome).length;
    const mailboxes = outcomes.filter(c => c.operational.outcome === "voicemail");
    return {
      owner, emailsSent: new Set(sent.map(t => t.id)).size,
      replies: new Set(replies.map(t => t.person_id ?? t.id)).size,
      bounces: new Set(bounces.map(t => t.person_id ?? t.id)).size,
      callsMade: made.length, intendedPerson: outcomes.filter(c => c.analysis.reached_intended_person === true).length,
      receptionists: count("receptionist_reached"), voicemailReached: mailboxes.length,
      voicemailMessagesAttempted: mailboxes.filter(c => typeof c.transcript === "string" && /^(?:AI|Alex):\s*.+(?:callback|call|reply|email)/im.test(c.transcript)).length,
      meetingsConfirmed: count("meeting_booked"), switchboardBlocked: count("phone_menu_unresolved"),
      technicalFailures: count("technical_failure"), active: live.filter(c => ["creating", "active"].includes(c.status)).length,
      queued: live.filter(c => c.status === "queued").length,
      needsReview: made.filter(c => c.review_required || c.status === "held").length,
    };
  });
}

export function activitySlackText(stats: ReturnType<typeof activityAnalytics>, day: string, base: string) {
  const total = (key: keyof Omit<(typeof stats)[number], "owner">) => stats.reduce((sum, seat) => sum + seat[key], 0);
  return [
    `*Nightwatch activity | ${day} | Eastern time*`,
    `*Team:* ${total("emailsSent")} emails sent · ${total("callsMade")} calls made · ${total("voicemailMessagesAttempted")} voicemail messages attempted · ${total("meetingsConfirmed")} confirmed call bookings`,
    ...stats.map(s => `*${s.owner === "josh" ? "Josh" : "Suuchi"}*\n${s.emailsSent} emails sent · ${s.replies} contacts replied · ${s.bounces} contacts bounced\n${s.callsMade} calls made · ${s.intendedPerson} intended contacts reached · ${s.receptionists} receptionist connections\n${s.voicemailReached} voicemail systems reached · ${s.voicemailMessagesAttempted} messages attempted\n${s.switchboardBlocked} unresolved switchboards · ${s.technicalFailures} technical failures · ${s.needsReview} calls needing review\n${s.queued} queued now · ${s.active} in progress now`),
    "Internal test calls are excluded. Sent does not mean inbox delivery. Voicemail messages are inferred from saved call reports and speech, not confirmed recordings. Queue counts are current; activity counts use the report date.",
    `<${base}/calls?owner=suuchi|Calls and transcripts> · <${base}/drafts/sent|Email results>`,
  ].join("\n\n");
}
