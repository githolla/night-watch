import { z } from "zod";

export const VOICE_PROMPT_VERSION = "email-followup-v9";
export const voiceOutcome = z.enum(["meeting_booked", "interested_followup", "callback_requested", "referral", "not_interested", "do_not_contact", "wrong_number", "voicemail", "no_answer", "technical_failure"]);
export function validVoiceTimezone(zone: string | null | undefined): zone is string {
  try { if (!zone) return false; new Intl.DateTimeFormat("en", { timeZone: zone }).format(); return true; } catch { return false; }
}
export function emailSentSpoken(sentAt: string | null, zone: string | null, now = new Date()): string {
  if (!sentAt || !validVoiceTimezone(zone)) return "recently";
  const sent = new Date(sentAt);
  if (!Number.isFinite(sent.getTime()) || sent > now) return "recently";
  const localDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const dayNumber = (date: Date) => { const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(date); const get = (name: string) => Number(parts.find(p => p.type === name)?.value); return Date.UTC(get("year"), get("month") - 1, get("day")); };
  if (localDate(sent) === localDate(now)) return "earlier today";
  if (dayNumber(now) - dayNumber(sent) === 86_400_000) return "yesterday";
  return `on ${sent.toLocaleDateString("en-US", { timeZone: zone, month: "long", day: "numeric" })}`;
}
export type VoiceEligibility = { sentAt: string | null; hasBody: boolean; hasBounce: boolean; hasReply: boolean; hasMeeting: boolean; suppressed: boolean; activeCall: boolean; timezone: string | null; generatedAt: string; expiresAt: string; eligibilityApproved: boolean };
export function voiceEligibility(input: VoiceEligibility, now = new Date(), delayBusinessDays = 1) {
  const reasons: string[] = [];
  if (!input.sentAt || !Number.isFinite(Date.parse(input.sentAt)) || Date.parse(input.sentAt) > now.getTime()) reasons.push("Email has not been confirmed sent");
  if (!input.hasBody) reasons.push("Missing exact sent email");
  if (input.hasBounce) reasons.push("Email bounced");
  if (input.hasReply) reasons.push("Reply requires handling");
  if (input.hasMeeting) reasons.push("Meeting already exists");
  if (input.suppressed) reasons.push("Contact suppressed");
  if (input.activeCall) reasons.push("Another call is active");
  if (!validVoiceTimezone(input.timezone)) reasons.push("Resolve the contact timezone");
  if (!input.eligibilityApproved) reasons.push("Calling eligibility is not approved");
  if (!Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt) <= now.getTime() || !Number.isFinite(Date.parse(input.generatedAt)) || Date.parse(input.generatedAt) > now.getTime() || now.getTime() - Date.parse(input.generatedAt) > 300_000) reasons.push("Eligibility is stale");
  if (!Number.isInteger(delayBusinessDays) || delayBusinessDays < 1 || delayBusinessDays > 5) reasons.push("Invalid follow-up delay");
  if (input.sentAt && Number.isFinite(Date.parse(input.sentAt)) && Number.isInteger(delayBusinessDays) && delayBusinessDays >= 1 && delayBusinessDays <= 5 && validVoiceTimezone(input.timezone)) {
    const due = nextVoiceCallAt(input.sentAt, input.timezone ?? "America/New_York", delayBusinessDays);
    if (Date.parse(due) > now.getTime()) reasons.push("Follow-up delay has not elapsed");
  }
  if (validVoiceTimezone(input.timezone)) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: input.timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    const weekday = parts.find(p => p.type === "weekday")?.value;
    const hour = Number(parts.find(p => p.type === "hour")?.value);
    if (["Sat", "Sun"].includes(weekday ?? "") || hour < 9 || hour >= 17) reasons.push("Outside approved 9am to 5pm weekday calling window");
  }
  return { allowed: reasons.length === 0, reasons };
}
export const voiceAnalysis = z.object({ outcome: voiceOutcome.nullable(), reached_intended_person: z.boolean().nullable(), workflow_discussed: z.string().max(1000).nullable(), pain_point: z.string().max(2000).nullable(), interest_level: z.enum(["low","medium","high"]).nullable(), meeting_requested: z.boolean(), callback_requested: z.boolean(), email_followup_requested: z.boolean(), do_not_contact_requested: z.boolean(), referral_name: z.string().max(300).nullable(), human_followup_reason: z.string().max(2000).nullable(), summary: z.string().max(4000) });
export function operationalVoiceOutcome(proposed: unknown, facts: { meetingConfirmed: boolean; suppressed: boolean; callbackSaved: boolean; emailQueued: boolean }) {
  const parsed = voiceAnalysis.safeParse(proposed);
  if (!parsed.success) return { outcome: facts.suppressed ? "do_not_contact" : facts.meetingConfirmed ? "meeting_booked" : facts.callbackSaved ? "callback_requested" : facts.emailQueued ? "interested_followup" : null, reviewRequired: true };
  const outcome = facts.suppressed ? "do_not_contact" : facts.meetingConfirmed ? "meeting_booked" : facts.callbackSaved ? "callback_requested" : facts.emailQueued ? "interested_followup" : parsed.data.outcome;
  const unsupported = (outcome === "meeting_booked" && !facts.meetingConfirmed) || (outcome === "do_not_contact" && !facts.suppressed) || (outcome === "callback_requested" && !facts.callbackSaved);
  return { outcome: unsupported ? null : outcome, reviewRequired: unsupported || parsed.data.do_not_contact_requested };
}

export function nextVoiceCallAt(sentAt: string, timezone: string, businessDays = 1): string {
  if (!validVoiceTimezone(timezone) || !Number.isFinite(Date.parse(sentAt)) || !Number.isInteger(businessDays) || businessDays < 1 || businessDays > 5) throw new Error("A real send time, timezone and one to five business days are required.");
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  const sent = parts(new Date(sentAt));
  const date = new Date(Date.UTC(Number(sent.year), Number(sent.month) - 1, Number(sent.day), 12));
  for (let i = 0; i < businessDays; i++) do { date.setUTCDate(date.getUTCDate() + 1); } while ([0,6].includes(date.getUTCDay()));
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 10);
  let guess = new Date(target);
  for (let i = 0; i < 3; i++) {
    const observed = parts(guess);
    guess = new Date(guess.getTime() + target - Date.UTC(Number(observed.year), Number(observed.month) - 1, Number(observed.day), Number(observed.hour), Number(observed.minute)));
  }
  return guess.toISOString();
}
