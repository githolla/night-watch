import { spokenEmailAddress } from "./voice-conversation.ts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { admin } from "./supabase/admin.ts";
import { voiceAvailability, voiceBook } from "./voice-calendar.ts";
import { VOICE_BOOKING } from "./voice-booking.ts";
import { operationalVoiceOutcome, validVoiceTimezone, VOICE_PROMPT_VERSION } from "./voice-policy.ts";

const attemptSchema = z.object({ id: z.uuid(), task_id: z.uuid().nullable(), person_id: z.uuid().nullable(), owner: z.enum(["josh","suuchi"]), mode: z.enum(["internal","pilot"]), destination: z.string(), status: z.string(), context_snapshot: z.record(z.string(), z.unknown()), eligibility_expires_at: z.string() });
export type VoiceAttempt = z.infer<typeof attemptSchema>;
export async function boundVoiceAttempt(callId: string): Promise<VoiceAttempt> {
  const result = await admin().from("voice_attempts").select("*").eq("vapi_call_id", callId).maybeSingle();
  if (result.error || !result.data) throw new Error("This call has no authenticated Nightwatch attempt. Hold for review.");
  return attemptSchema.parse(result.data);
}
export async function reserveInternalVoiceAttempt(input: { destination?: string; taskId?: string; personId?: string; context: Record<string, unknown>; attemptKey: string }) {
  const db = admin();
  const id = randomUUID();
  const result = await db.from("voice_attempts").insert({ id, task_id: input.taskId ?? null, person_id: input.personId ?? null, owner: "suuchi", mode: "internal", destination: z.enum([VOICE_BOOKING.transferNumber, "+19178090711"]).parse(input.destination ?? VOICE_BOOKING.transferNumber), attempt_key: input.attemptKey, status: "creating", context_snapshot: input.context, prompt_version: VOICE_PROMPT_VERSION, eligibility_expires_at: new Date(Date.now() + 300_000).toISOString() }).select("id").single();
  if (result.error) throw new Error("Could not reserve the internal call. Check the voice migration, duplicate attempt or existing active call before retrying.");
  return id;
}
export async function attachVoiceCall(attemptId: string, callId: string) {
  const result = await admin().from("voice_attempts").update({ vapi_call_id: callId, status: "active" }).eq("id", attemptId).eq("status", "creating").select("id");
  if (result.error || !result.data?.length) throw new Error("Call created but its audit link could not be confirmed. Hold and reconcile; do not redial.");
}
export async function holdVoiceAttempt(attemptId: string, reason: string) {
  const result = await admin().from("voice_attempts").update({ status: "held", review_required: true, ended_reason: reason.slice(0, 1000) }).eq("id", attemptId);
  if (result.error) throw new Error("Voice attempt could not be held. Keep external dispatch disabled and reconcile manually.");
}
const availabilityInput = z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), timezone: z.string().refine(validVoiceTimezone), prospectRequested: z.boolean().default(false) });
const bookInput = z.object({ slot_id: z.uuid(), email: z.email(), confirmed: z.literal(true) });
const requestInput = z.object({ category: z.enum(["question", "decline", "wrong_number", "referral", "suppression_failure"]).default("question"), reason: z.string().trim().min(1).max(3000), expressed_words: z.string().trim().min(1).max(3000) });
const callbackInput = requestInput.extend({ start: z.string().datetime({ offset: true }), timezone: z.string().refine(validVoiceTimezone), confirmed: z.literal(true) });
const suppressInput = requestInput.extend({ scope: z.enum(["voice","all"]) });
const emailInput = requestInput.extend({ email: z.email(), confirmed: z.literal(true) });
const slotSchema = z.object({ id: z.uuid(), start_at: z.string(), end_at: z.string(), timezone: z.string().refine(validVoiceTimezone), prospect_requested: z.boolean(), expires_at: z.string() });

export async function executeVoiceTool(attempt: VoiceAttempt, toolId: string, name: string, args: unknown): Promise<Record<string, unknown>> {
  if (!["active", "creating"].includes(attempt.status) && !(name === "request_human_followup" && attempt.status === "held")) throw new Error("This call is no longer active.");
  const db = admin();
  if (attempt.mode !== "internal" && attempt.person_id && !["suppress_contact", "request_human_followup"].includes(name)) {
    const suppression = await db.from("voice_suppressions").select("scope").eq("person_id", attempt.person_id).maybeSingle();
    if (suppression.error || suppression.data) throw new Error("Further outreach actions are held after a suppression request.");
  }
  if (name === "nightwatch_availability") {
    const input = availabilityInput.parse(args);
    const available = await voiceAvailability(input.start, input.end, input.prospectRequested);
    const slots = available.slots.slice(0, 2).map(slot => ({ id: randomUUID(), attempt_id: attempt.id, start_at: slot.start, end_at: slot.end, timezone: input.timezone, prospect_requested: input.prospectRequested, expires_at: new Date(Date.now() + 600_000).toISOString() }));
    if (slots.length) {
      const saved = await db.from("voice_slots").upsert(slots, { onConflict: "attempt_id,start_at" });
      if (saved.error) throw new Error("Could not save the offered meeting options.");
    }
    if (!slots.length) return { status: "available", timezone: input.timezone, duration_minutes: VOICE_BOOKING.durationMinutes, slots: [] };
    const stored = await db.from("voice_slots").select("*").eq("attempt_id", attempt.id).in("start_at", slots.map(slot => slot.start_at)).gt("expires_at", new Date().toISOString());
    if (stored.error) throw new Error("Could not confirm offered meeting options.");
    return { status: "available", timezone: input.timezone, duration_minutes: VOICE_BOOKING.durationMinutes, slots: z.array(slotSchema).parse(stored.data ?? []).sort((a,b) => a.start_at.localeCompare(b.start_at)).map(slot => ({ slot_id: slot.id, start_at: slot.start_at, spoken_label: new Date(slot.start_at).toLocaleString("en-US", { timeZone: input.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "long" }) })) };
  }
  const known = ["nightwatch_book", "request_email_followup", "schedule_callback", "suppress_contact", "request_human_followup"];
  if (!known.includes(name)) throw new Error("Unknown tool");
  const input = name === "nightwatch_book" ? bookInput.parse(args) : name === "schedule_callback" ? callbackInput.parse(args) : name === "suppress_contact" ? suppressInput.parse(args) : name === "request_email_followup" ? emailInput.parse(args) : requestInput.parse(args);
  const actionKey = name === "nightwatch_book" ? "meeting-booking" : name === "request_email_followup" ? "email-followup" : name === "schedule_callback" ? "callback-request" : name === "suppress_contact" ? `suppression:${suppressInput.parse(args).scope}` : toolId;
  const claim = await db.from("voice_actions").insert({ attempt_id: attempt.id, tool_call_id: actionKey, kind: name, details: input }).select("id").single();
  if (claim.error) {
    const prior = await db.from("voice_actions").select("result,status").eq("attempt_id", attempt.id).eq("tool_call_id", actionKey).maybeSingle();
    if (prior.error || !prior.data) throw new Error("Could not reserve this action. Do not repeat it blindly.");
    return prior.data.result ? z.record(z.string(), z.unknown()).parse(prior.data.result) : { status: "pending_reconciliation", message: "This request already exists. A human must reconcile it before retrying." };
  }
  try {
    let result: Record<string, unknown>;
    if (name === "nightwatch_book") {
      const booking = bookInput.parse(args);
      const read = await db.from("voice_slots").select("*").eq("id", booking.slot_id).eq("attempt_id", attempt.id).single();
      if (read.error || !read.data) throw new Error("Choose a slot offered for this call.");
      const slot = slotSchema.parse(read.data);
      if (Date.parse(slot.expires_at) <= Date.now() || Date.parse(slot.start_at) <= Date.now()) throw new Error("That offered slot expired. Ask for a fresh availability check.");
      if (attempt.mode === "internal" && attempt.context_snapshot.live_calendar_test === true) {
        if (booking.email.toLowerCase() !== VOICE_BOOKING.calendar) throw new Error("Live calendar tests can only use operations@nine-67.com. No prospect invitation was sent.");
        const invite = await voiceBook({ start: slot.start_at, email: VOICE_BOOKING.calendar, confirmed: true, prospectRequested: slot.prospect_requested, internalTest: true }, attempt.id);
        result = { status: "confirmed", internal_test: true, invite_status: "sent", ...invite, attendee_email: VOICE_BOOKING.calendar, attendee_email_spoken: spokenEmailAddress(VOICE_BOOKING.calendar), start_at: slot.start_at, end_at: slot.end_at, timezone: slot.timezone, message: "The real calendar test event was created on the connected executive team calendar. No prospect was invited. Confirm the returned time, then wait for the caller before ending." };
      } else if (attempt.mode === "internal") result = { status: "simulated", invitation_sent: false, attendee_email: booking.email, attendee_email_spoken: spokenEmailAddress(booking.email), start_at: slot.start_at, timezone: slot.timezone, message: "Rehearsal booking recorded. No calendar event or invitation was created. Confirm this test result, ask if anything else is needed and wait for the caller to finish before ending." };
      else {
        const contact = z.object({ email: z.email() }).parse(attempt.context_snapshot.contact);
        if (booking.email.toLowerCase() !== contact.email.toLowerCase()) throw new Error("A changed attendee email requires human review.");
        const invite = await voiceBook({ start: slot.start_at, email: contact.email, confirmed: true, prospectRequested: slot.prospect_requested }, attempt.id);
        if (attempt.task_id) {
          const cadence = await db.from("cadences").select("card_id").eq("id", attempt.task_id).eq("owner", attempt.owner).single();
          if (cadence.error || !cadence.data) throw new Error("Calendar booking succeeded but sequence reconciliation needs human review.");
          const card = await db.from("cards").update({ status: "meeting", auto_send_hold: true }).eq("id", cadence.data.card_id);
          const stopped = await db.from("cadences").update({ status: "completed" }).eq("id", attempt.task_id);
          if (card.error || stopped.error) throw new Error("Calendar booking succeeded but outreach could not be stopped. Urgent review required.");
        }
        result = { status: "confirmed", invite_status: "sent", ...invite, attendee_email: contact.email, attendee_email_spoken: spokenEmailAddress(contact.email), start_at: slot.start_at, end_at: slot.end_at, timezone: slot.timezone, spoken_confirmation: new Date(slot.start_at).toLocaleString("en-US", { timeZone: slot.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "long" }) };
      }
    } else if (name === "suppress_contact") {
      const suppression = suppressInput.parse(args);
      const saved = await db.rpc("suppress_voice_contact", { p_attempt: attempt.id, p_scope: suppression.scope, p_reason: suppression.expressed_words });
      if (saved.error) throw new Error("Suppression could not be confirmed. Further calls are held for urgent review.");
      result = { ...z.record(z.string(), z.unknown()).parse(saved.data), message: attempt.mode === "internal"
        ? "Opt-out recorded for this rehearsal only. Say: That request is recorded for this test. Goodbye. Then invoke endCall immediately. Do not ask anything else, restart the email topic, or make a promise of real suppression."
        : "Suppression succeeded. Briefly confirm the requested scope and say goodbye, then invoke endCall immediately. Do not ask anything else or restart outreach, even if the caller makes small talk." };
    } else if (name === "schedule_callback") {
      const callback = callbackInput.parse(args);
      if (Date.parse(callback.start) <= Date.now()) throw new Error("Confirm a future callback time and timezone.");
      result = { status: attempt.mode === "internal" ? "simulated" : "queued", start_at: callback.start, timezone: callback.timezone, message: "Explicit callback request saved for the team; automated callback dispatch remains disabled." };
    } else if (name === "request_email_followup") {
      const followup = emailInput.parse(args);
      const contact = z.object({ email: z.email() }).parse(attempt.context_snapshot.contact);
      if (followup.email.toLowerCase() !== contact.email.toLowerCase()) throw new Error("A changed recipient requires human review; nothing sent.");
      result = { status: attempt.mode === "internal" ? "simulated" : "queued", sent: false, message: "Email request saved for human review. No email has been sent." };
    } else {
      const followup = requestInput.parse(args);
      if (attempt.mode !== "internal" && followup.category === "decline" && attempt.task_id) {
        const stopped = await db.from("cadences").update({ status: "stopped" }).eq("id", attempt.task_id).eq("owner", attempt.owner);
        if (stopped.error) throw new Error("Could not stop the declined sequence. Hold for review.");
      }
      if (attempt.mode !== "internal" && followup.category === "wrong_number") await holdProspectOutreach(attempt, "voice", "Wrong number needs correction");
      result = { status: attempt.mode === "internal" ? "simulated" : "queued", message: "Human follow-up request saved for the call owner." };
    }
    const status = result.status === "confirmed" ? "confirmed" : result.status === "simulated" ? "simulated" : "queued";
    const saved = await db.from("voice_actions").update({ result, status }).eq("id", claim.data.id);
    if (saved.error) throw new Error("Action result could not be saved. Hold for reconciliation.");
    return result;
  } catch (error) {
    await db.from("voice_actions").update({ status: "held" }).eq("id", claim.data.id);
    if (name === "suppress_contact" && attempt.mode !== "internal") await holdProspectOutreach(attempt, suppressInput.parse(args).scope, "Urgent suppression failure");
    await holdVoiceAttempt(attempt.id, name === "suppress_contact" ? "Urgent: suppression request could not be confirmed" : "Tool action needs reconciliation");
    throw error;
  }
}

export async function saveVoiceReport(attempt: VoiceAttempt, message: { endedReason?: string; transcript?: string; analysis?: unknown }) {
  const db = admin();
  const actions = await db.from("voice_actions").select("kind,status").eq("attempt_id", attempt.id);
  if (actions.error) throw new Error("Could not reconcile the call's operational actions.");
  const confirmed = (kind: string, status: string) => (actions.data ?? []).some(action => action.kind === kind && action.status === status);
  const truth = operationalVoiceOutcome(message.analysis, { meetingConfirmed: confirmed("nightwatch_book", "confirmed"), suppressed: confirmed("suppress_contact", "confirmed"), callbackSaved: confirmed("schedule_callback", "queued"), emailQueued: confirmed("request_email_followup", "queued") }, message);
  const transcript = (message.transcript ?? "").slice(0, 100_000);
  const possibleOptOut = /\b(stop calling|remove me|take me off|do not contact|don't contact)\b/i.test(transcript);
  if (possibleOptOut && attempt.mode !== "internal") {
    await holdProspectOutreach(attempt, "all", "Possible missed opt-out: urgent review required");
    await holdVoiceAttempt(attempt.id, "Possible missed opt-out: urgent review required");
    await db.from("voice_actions").upsert({ attempt_id: attempt.id, tool_call_id: "report-optout-review", kind: "request_human_followup", status: "queued", details: { urgent: true, reason: "Possible opt-out detected in transcript. Review immediately before any outreach." } }, { onConflict: "attempt_id,tool_call_id", ignoreDuplicates: true });
  }
  const latest = await db.from("voice_attempts").select("status,review_required,report").eq("id", attempt.id).single();
  if (latest.error) throw new Error("Could not verify the call hold before saving its report.");
  const preserveHold = latest.data.status === "held" || latest.data.status === "cancelled";
  const saved = await db.from("voice_attempts").update({ status: preserveHold ? latest.data.status : possibleOptOut && attempt.mode !== "internal" ? "held" : "ended", ended_reason: message.endedReason ?? null, report: { transcript, analysis: message.analysis ?? null, operational: truth }, review_required: latest.data.review_required || truth.reviewRequired || possibleOptOut }).eq("id", attempt.id);
  if (saved.error) throw new Error("Could not save the call report.");
  return truth;
}

async function holdProspectOutreach(attempt: VoiceAttempt, scope: "voice" | "all", reason: string) {
  if (attempt.mode === "internal" || !attempt.person_id) return;
  const db = admin();
  const prior = await db.from("voice_suppressions").select("scope").eq("person_id", attempt.person_id).maybeSingle();
  if (prior.error) throw new Error("Could not check the suppression hold. Keep external dispatch disabled.");
  const suppressed = await db.from("voice_suppressions").upsert({ person_id: attempt.person_id, scope: prior.data?.scope === "all" ? "all" : scope, reason });
  if (suppressed.error) throw new Error("Could not save the suppression hold. Keep external dispatch disabled.");
  if (scope === "all") {
    const cards = await db.from("cards").update({ auto_send_hold: true }).eq("person_id", attempt.person_id);
    const cadences = await db.from("cadences").update({ status: "paused" }).eq("person_id", attempt.person_id).in("status", ["active", "completed"]);
    if (cards.error || cadences.error) throw new Error("Could not confirm the outreach hold. Urgent manual review required.");
  }
}
