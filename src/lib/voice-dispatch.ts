import { z } from "zod";
import { admin } from "./supabase/admin.ts";
import { loadCallTasks } from "./call-tasks.ts";
import { currentVoiceFollowup } from "./voice-sent-context.ts";
import { voiceEligibility, VOICE_PROMPT_VERSION } from "./voice-policy.ts";
import { voiceAssistantPayload } from "./voice-assistant.ts";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "./voice-booking.ts";
import { attachVoiceCall, holdVoiceAttempt } from "./voice-runtime.ts";
import { vapiRequest } from "./vapi.ts";

const claimed = z.object({ id: z.uuid(), task_id: z.uuid(), person_id: z.uuid(), owner: z.enum(["josh", "suuchi"]), destination: z.string(), eligibility_expires_at: z.string() });
const approvalSchema = z.object({ timezone: z.string(), approved_until: z.string(), approved_number: z.string(), approval_basis: z.enum(["written_consent", "reviewed_business_landline"]), approval_evidence: z.string().trim().min(1), delay_business_days: z.number().int() });

export async function dispatchVoicePilot() {
  const db = admin();
  const config = await db.from("voice_pilot_config").select("enabled,starts_at,ends_at,booking_test_passed,voicemail_test_passed,optout_test_passed").eq("id", true).single();
  if (config.error || !config.data) return { callsPlaced: 0, blocked: "Apply the voice pilot migration before enabling dispatch." };
  if (!config.data.enabled) return { callsPlaced: 0, blocked: "Monday pilot is staged; external calling is off." };
  if (!config.data.booking_test_passed || !config.data.voicemail_test_passed || !config.data.optout_test_passed) return { callsPlaced: 0, blocked: "Complete booking, voicemail and opt-out tests before launch." };
  if (Date.now() < Date.parse(config.data.starts_at) || Date.now() >= Date.parse(config.data.ends_at)) return { callsPlaced: 0, blocked: "Outside the configured pilot dates." };
  const reservation = await db.rpc("claim_voice_pilot");
  if (reservation.error) throw new Error("Could not atomically reserve a pilot call. Nothing dialed.");
  const attempts = z.array(claimed).parse(reservation.data ?? []);
  if (!attempts.length) return { callsPlaced: 0, blocked: "No due eligible call, daily cap reached, or another call is active." };
  const attempt = attempts[0];
  try {
    const tasks = await loadCallTasks(db);
    const task = tasks.find(item => item.id === attempt.task_id && item.personId === attempt.person_id && item.owner === attempt.owner && item.plan.status === "pending");
    if (!task) throw new Error("Contact is no longer eligible: reply, bounce, meeting, opt-out or changed call plan.");
    const read = await db.from("voice_eligibility").select("*").eq("person_id", attempt.person_id).single();
    if (read.error) throw new Error("Could not refresh automated-calling eligibility.");
    const approval = approvalSchema.parse(read.data);
    const digits = task.plan.phone?.number.replace(/\D/g, "") ?? "";
    const destination = `+${digits.length === 10 ? "1" : ""}${digits}`;
    if (approval.approved_number !== attempt.destination || destination !== attempt.destination) throw new Error("Phone number no longer matches the recorded eligibility evidence.");
    const followup = await currentVoiceFollowup(task, approval.timezone);
    const now = new Date();
    const eligibility = voiceEligibility({ sentAt: task.plan.firstEmailAt, hasBody: Boolean(followup.context.email_body.trim() && followup.context.email_subject), hasBounce: task.bounced, hasReply: false, hasMeeting: false, suppressed: false, activeCall: false, timezone: approval.timezone, generatedAt: followup.context.context_generated_at, expiresAt: approval.approved_until, eligibilityApproved: true }, now, approval.delay_business_days);
    if (!eligibility.allowed) throw new Error(eligibility.reasons.join("; "));
    const assistantId = process.env.VAPI_ASSISTANT_ID;
    if (!assistantId) throw new Error("Configure the production assistant.");
    const numbers = z.array(z.object({ id: z.string(), number: z.string(), assistantId: z.string().nullish() })).parse(await vapiRequest("/phone-number"));
    const phoneNumberId = numbers.find(number => number.number === VOICE_BOOKING.callerNumber && number.assistantId === assistantId)?.id;
    if (!phoneNumberId) throw new Error("The originating number is not linked to the configured assistant.");
    const assistant = await vapiRequest(`/assistant/${assistantId}`);
    const phone = z.object({ number: z.literal(VOICE_BOOKING.callerNumber), assistantId: z.literal(assistantId) }).parse(await vapiRequest(`/phone-number/${phoneNumberId}`));
    const payload = voiceAssistantPayload(assistant, process.env.VAPI_WEBHOOK_SECRET ?? "");
    const refreshed = await db.from("voice_attempts").update({ context_snapshot: { ...followup.context, dispatch_enabled: true, live_calendar_test: false }, prompt_version: VOICE_PROMPT_VERSION, eligibility_expires_at: approval.approved_until }).eq("id", attempt.id).eq("status", "creating").select("id");
    if (refreshed.error || !refreshed.data?.length) throw new Error("Call canceled during final checks.");
    const call = z.object({ id: z.string() }).parse(await vapiRequest("/call", "POST", {
      assistantId: phone.assistantId, phoneNumberId, customer: { number: attempt.destination, name: task.name },
      assistantOverrides: {
        firstMessageMode: payload.firstMessageMode,
        firstMessageInterruptionsEnabled: payload.firstMessageInterruptionsEnabled,
        startSpeakingPlan: payload.startSpeakingPlan, stopSpeakingPlan: payload.stopSpeakingPlan,
        silenceTimeoutSeconds: payload.silenceTimeoutSeconds, maxDurationSeconds: payload.maxDurationSeconds, backgroundSound: payload.backgroundSound,
        endCallMessage: payload.endCallMessage, endCallPhrases: payload.endCallPhrases,
        voicemailDetection: payload.voicemailDetection,
        server: payload.server, serverMessages: payload.serverMessages,
        firstMessage: task.plan.phone?.kind === "company" ? "" : followup.firstMessage,
        voicemailMessage: followup.voicemailMessage,
        variableValues: { first_name: followup.context.first_name, full_name: task.name, call_context: JSON.stringify(followup.context) },
        model: { ...payload.model, messages: [{ role: "system", content: `${VOICE_INSTRUCTIONS}\n${followup.instructions}\nThis is a live approved follow-up, not an internal rehearsal. Use real availability and booking tools. Do not mention internal tests or test addresses.` }] },
      },
    }));
    await attachVoiceCall(attempt.id, call.id);
    return { callsPlaced: 1, callId: call.id, attemptId: attempt.id };
  } catch (error) {
    await holdVoiceAttempt(attempt.id, error instanceof Error ? error.message : "Call creation uncertain. Reconcile before retrying.");
    throw error;
  }
}
