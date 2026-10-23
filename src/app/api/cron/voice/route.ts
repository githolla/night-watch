import { auditVoicePhones } from "@/lib/voice-phone-audit";
import { VOICE_TEST_DURATION_SECONDS, VOICE_TURN_TIMING } from "@/lib/voice-conversation";
import { prepareVoiceQueue } from "@/lib/voice-queue";
import { ensureVoiceStructuredOutput, voiceStructuredResult } from "@/lib/voice-analysis";
import { reserveInternalVoiceAttempt, attachVoiceCall, holdVoiceAttempt, boundVoiceAttempt, saveVoiceReport } from "@/lib/voice-runtime";
import { currentVoiceFollowup } from "@/lib/voice-sent-context";
import { admin } from "@/lib/supabase/admin";
import { loadCallTasks } from "@/lib/call-tasks";
import { voiceFollowup } from "@/lib/voice-followup";
import { cronAuthorized } from "@/lib/auth";
import { vapiStatus } from "@/lib/vapi";
import { vapiRequest } from "@/lib/vapi";
import { voiceAssistantPayload } from "@/lib/voice-assistant";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "@/lib/voice-booking";
import { voiceAvailability } from "@/lib/voice-calendar";
import { checkVoiceTransport, enableUsVoiceCalling } from "@/lib/voice-transport";
import { z } from "zod";

export const maxDuration = 120;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await vapiStatus(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : "Could not connect to Vapi" }, { status: 502 });
  }
}

const setup = z.object({ action: z.enum(["preview", "configure", "calendar-check", "test-call", "call-status", "transport-check", "enable-us-calling", "followup-preview", "test-followup", "reconcile-call", "queue-refresh", "phone-audit"]), assistantId: z.uuid(), phoneNumberId: z.uuid(), callId: z.uuid().optional(), taskId: z.uuid().optional(), attemptKey: z.uuid().optional(), testVoicemail: z.boolean().optional(), liveCalendarTest: z.boolean().default(false), testRecipient: z.enum(["josh", "suuchi"]).default("josh"), voiceChoice: z.enum(["clara", "sid", "savannah", "jess", "elliot"]).optional() });

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = setup.parse(await request.json());
    if (input.assistantId !== process.env.VAPI_ASSISTANT_ID) throw new Error("Assistant does not match the configured Nightwatch assistant.");
    if (input.action === "queue-refresh") return Response.json({ ok: true, ...await prepareVoiceQueue() });
    if (input.action === "reconcile-call") {
      if (!input.callId) throw new Error("Provide the call ID to reconcile.");
      const attempt = await boundVoiceAttempt(input.callId);
      const raw = z.object({ assistantId: z.string(), customer: z.object({ number: z.string() }), status: z.string(), endedReason: z.string().optional(), transcript: z.string().optional(), artifact: z.unknown().optional() }).parse(await vapiRequest(`/call/${input.callId}`));
      if (raw.assistantId !== input.assistantId || raw.customer.number !== attempt.destination || raw.status !== "ended") throw new Error("Call identity or terminal status could not be verified.");
      return Response.json({ ok: true, ...await saveVoiceReport(attempt, { endedReason: raw.endedReason, transcript: raw.transcript, analysis: voiceStructuredResult(raw.artifact) }) });
    }
    if (input.action === "calendar-check") {
      const start = new Date(Date.now() + 3_600_000).toISOString();
      const end = new Date(Date.now() + 7 * 86_400_000).toISOString();
      return Response.json({ ok: true, ...await voiceAvailability(start, end, false), invitationsCreated: 0 });
    }
    if (input.action === "call-status") {
      if (!input.callId) throw new Error("Provide the internal test call ID.");
      const raw = z.record(z.string(), z.unknown()).parse(await vapiRequest(`/call/${input.callId}`));
      const call = z.object({ id: z.string(), assistantId: z.string(), customer: z.object({ number: z.enum([VOICE_BOOKING.transferNumber, "+19178090711"]) }), status: z.string(), endedReason: z.string().optional(), endedMessage: z.string().optional(), transcript: z.string().optional(), phoneCallProviderId: z.string().optional(), cost: z.number().optional() }).parse(raw);
      if (call.assistantId !== input.assistantId) throw new Error("Call belongs to another assistant.");
      const turns = z.array(z.object({ role: z.string(), message: z.string().optional(), secondsFromStart: z.number().optional(), duration: z.number().optional() })).safeParse(raw.messages);
      const firstTurns = turns.success ? turns.data.filter(turn => ["user", "bot", "assistant"].includes(turn.role)).slice(0, 4).map(turn => ({ ...turn, message: turn.message?.slice(0, 200) })) : [];
      return Response.json({ ok: true, call, firstTurns, toolTurns: Array.isArray(raw.messages) ? raw.messages.filter((turn: unknown) => typeof turn === "object" && turn !== null && "role" in turn && ["tool", "tool_calls", "function"].includes(String(turn.role))) : [], diagnosticFields: Object.keys(raw), artifactFields: raw.artifact && typeof raw.artifact === "object" ? Object.keys(raw.artifact) : [] });
    }
    const [assistant, phone] = await Promise.all([
      vapiRequest(`/assistant/${input.assistantId}`), vapiRequest(`/phone-number/${input.phoneNumberId}`),
    ]);
    const number = z.object({ number: z.literal(VOICE_BOOKING.callerNumber), assistantId: z.string().nullable().optional() }).parse(phone);
    if (number.assistantId && number.assistantId !== input.assistantId) throw new Error("This number is assigned to another assistant; review routing first.");
    if (input.action === "phone-audit") return Response.json({ ok: true, ...await auditVoicePhones(phone, input.taskId), callsPlaced: 0 });
    if (input.action === "enable-us-calling") return Response.json({ ok: true, ...await enableUsVoiceCalling(phone) });
    if (input.action === "transport-check") return Response.json({ ok: true, transport: await checkVoiceTransport(phone) });
    const payload = voiceAssistantPayload(assistant, process.env.VAPI_WEBHOOK_SECRET ?? "", input.voiceChoice);
    let followup: ReturnType<typeof voiceFollowup> | null = null;
    if (["followup-preview", "test-followup"].includes(input.action)) {
      const tasks = await loadCallTasks(admin(), "suuchi");
      const task = input.taskId ? tasks.find(item => item.id === input.taskId) : tasks.filter(item => item.plan.status === "pending" && item.emailBody.trim()).sort((a, b) => b.plan.firstEmailAt.localeCompare(a.plan.firstEmailAt))[0];
      if (!task) throw new Error("No eligible sent-email follow-up found.");
      followup = await currentVoiceFollowup(task);
      if (input.action === "followup-preview") return Response.json({ ok: true, ...followup, callsPlaced: 0 });
    }
    if (input.action === "test-call" || input.action === "test-followup") {
      if (number.assistantId !== input.assistantId) throw new Error("Configure and assign the assistant before calling.");
      const testName = input.testRecipient === "suuchi" ? "Suuchi" : "Josh";
      const destination = input.testRecipient === "suuchi" ? "+19178090711" : VOICE_BOOKING.transferNumber;
      const testContext = { ...(followup?.context ?? { internal: true, contact: null }), live_calendar_test: input.liveCalendarTest };
      if (input.liveCalendarTest) await voiceAvailability(new Date(Date.now() + 3_600_000).toISOString(), new Date(Date.now() + 7 * 86_400_000).toISOString(), false);
      const bookingTestInstructions = input.liveCalendarTest
        ? `This rehearsal has REAL calendar booking enabled. Availability comes from the connected executive team calendar. A confirmed booking creates a real event labelled TEST. The only allowed attendee is ${VOICE_BOOKING.calendar}; pass that exact address to nightwatch_book, not the prospect address from the roleplay. Do not read or spell that internal email aloud unless explicitly asked. Say "This will create a real test event on our executive team calendar." Confirm the chosen slot and timezone and get explicit agreement. Only confirm success after the tool returns confirmed. All other outreach actions remain simulated.`
        : "Calendar availability is real, but booking is simulated: no calendar event or invitation is created.";
      const attemptId = await reserveInternalVoiceAttempt({ destination, taskId: followup?.taskId, personId: followup?.personId, context: testContext, attemptKey: input.attemptKey ?? `internal:${input.testRecipient}:${followup?.taskId ?? "audio"}:${Math.floor(Date.now() / 300_000)}` });
      let result: unknown;
      try {
        result = await vapiRequest("/call", "POST", {
        assistantId: input.assistantId, phoneNumberId: input.phoneNumberId,
        customer: { number: destination, name: `${testName}: internal voice test` },
        assistantOverrides: {
          maxDurationSeconds: VOICE_TEST_DURATION_SECONDS,
          ...VOICE_TURN_TIMING,
          voicemailDetection: input.testVoicemail ? { provider: "vapi" } : "off",
          ...(input.testVoicemail ? { voicemailMessage: followup?.voicemailMessage ?? "Hi, this is Alex with Nine Six Seven. Please call two zero one, five eight one, four three zero nine. Thank you." } : {}),
          ...(payload.voice ? { voice: payload.voice } : {}),
          variableValues: { first_name: followup?.context.first_name ?? testName, full_name: followup?.context.full_name ?? testName, call_context: JSON.stringify(testContext) },
          firstMessage: followup?.firstMessage ?? `Hi, this is Alex with Nine Six Seven. Can you hear me clearly?`,
          model: { ...payload.model, messages: [{ role: "system", content: `${VOICE_INSTRUCTIONS}\n${followup ? followup.instructions + `\nThis is an internal roleplay with ${testName} acting as the named prospect. Use the supplied email context for the roleplay. No prospect is being called. If asked, explain that this is a rehearsal.` : `This is an internal test with ${testName}, not a prospect call. No prospect email or company history is provided. Say so if asked.`} The tester is ${testName}. If they identify themselves by their own name instead of the roleplay prospect name, acknowledge that this is the rehearsal and continue; do not record a wrong number. Help them test natural conversation and calendar availability. Do not transfer during this internal rehearsal. ${bookingTestInstructions}` }] },
        },
      });
      } catch (error) {
        await holdVoiceAttempt(attemptId, "Vapi call creation was unsuccessful or uncertain. Reconcile before retrying.");
        throw error;
      }
      const call = z.object({ id: z.string(), status: z.string().optional() }).parse(result);
      await attachVoiceCall(attemptId, call.id);
      return Response.json({ ok: true, call, destination, liveCalendarTest: input.liveCalendarTest, ...(followup ? { taskId: followup.taskId, mode: "internal-followup-rehearsal" } : {}) });
    }
    if (input.action === "configure") {
      const audit = await admin().from("voice_attempts").select("id").limit(1);
      if (audit.error) throw new Error("Apply the voice follow-up migration before configuring the agent.");
      const outputId = await ensureVoiceStructuredOutput();
      const currentArtifacts = z.object({ artifactPlan: z.record(z.string(), z.unknown()).optional() }).parse(assistant).artifactPlan ?? {};
      const priorOutputs = z.array(z.string()).parse(currentArtifacts.structuredOutputIds ?? []);
      await vapiRequest(`/assistant/${input.assistantId}`, "PATCH", { ...payload, artifactPlan: { ...currentArtifacts, structuredOutputIds: [...new Set([...priorOutputs, outputId])] } });
      await vapiRequest(`/phone-number/${input.phoneNumberId}`, "PATCH", { assistantId: input.assistantId });
    }
    const currentClosing = z.object({ endCallMessage: z.string().optional(), endCallPhrases: z.array(z.string()).optional() }).parse(assistant);
    const voice = z.object({ voice: z.object({ provider: z.string(), voiceId: z.string(), version: z.union([z.number(), z.string()]).optional(), language: z.string().optional() }).optional() }).parse(assistant).voice;
    return Response.json({ ok: true, action: input.action, assistantId: input.assistantId, phoneNumber: VOICE_BOOKING.callerNumber, ...(input.voiceChoice ? { voiceChoice: input.voiceChoice } : {}), voice: payload.voice ?? voice, currentClosing, timing: VOICE_TURN_TIMING, tools: ["nightwatch_availability", "nightwatch_book", "request_email_followup", "schedule_callback", "suppress_contact", "request_human_followup", "transferCall", "endCall"], callsPlaced: 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not configure Vapi" }, { status: 400 });
  }
}
