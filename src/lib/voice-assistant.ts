import { VOICE_TURN_TIMING, VOICE_CHOICES, type VoiceChoice } from "./voice-conversation.ts";
import { z } from "zod";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "./voice-booking.ts";

const callback = "https://night-watch-snowy.vercel.app/api/voice/vapi";
const existingAssistant = z.object({
  id: z.string(),
  model: z.record(z.string(), z.unknown()),
  server: z.object({ url: z.string().optional() }).optional(),
});
const tool = z.object({ type: z.string(), function: z.object({ name: z.string().optional() }).optional() }).passthrough();
const calendarNames = ["nightwatch_availability", "nightwatch_book", "request_email_followup", "schedule_callback", "suppress_contact", "request_human_followup"];

export function voiceAssistantPayload(value: unknown, secret: string, voiceChoice?: VoiceChoice) {
  if (secret.length < 32) throw new Error("Configure a strong VAPI_WEBHOOK_SECRET first.");
  const current = existingAssistant.parse(value);
  if (current.server?.url && current.server.url !== callback) throw new Error("Assistant uses another server integration; review it before replacing it.");
  if (Array.isArray(current.model.toolIds) && current.model.toolIds.length) throw new Error("Assistant has saved tools; review them before replacing its calendar integration.");
  const tools = z.array(tool).parse(current.model.tools ?? []);
  if (tools.some(item => item.type === "function" && !calendarNames.includes(item.function?.name ?? ""))) throw new Error("Assistant has unrelated function tools; review them before changing its callback.");
  const retained = tools.filter(item => !item.type.startsWith("google.calendar.") && !["transferCall", "endCall"].includes(item.type) && !calendarNames.includes(item.function?.name ?? ""));
  const date = { type: "string", description: "ISO 8601 date and time with explicit UTC offset" };
  return {
    name: "Alex | Nine-67",
    ...(voiceChoice ? { voice: VOICE_CHOICES[voiceChoice] } : {}),
    firstMessage: "Hi, this is Alex with Nine Six Seven. Am I speaking with the person who handles this workflow?",
    maxDurationSeconds: 300,
    endCallMessage: "Thanks for your time. Goodbye.",
    endCallPhrases: [],
    backgroundSound: "off",
    ...VOICE_TURN_TIMING,
    voicemailMessage: "",
    voicemailDetection: { provider: "vapi" },
    model: {
      ...current.model,
      messages: [{ role: "system", content: VOICE_INSTRUCTIONS }],
      tools: [
        ...retained,
        { type: "function", messages: [{ type: "request-start", content: "" }], function: { name: "nightwatch_availability", description: "Find available 15-minute meetings with Suuchi, respecting preferred hours, pickup and 15-minute buffers.", parameters: { type: "object", properties: { start: date, end: date, timezone: { type: "string", description: "Prospect-confirmed IANA timezone" }, prospectRequested: { type: "boolean", description: "True only if the prospect explicitly requests a time outside preferred hours" } }, required: ["start", "end", "timezone", "prospectRequested"] } } },
        { type: "function", messages: [{ type: "request-start", content: "" }], function: { name: "nightwatch_book", description: "Book only a slot returned for this call after explicit agreement. Internal rehearsals normally simulate booking. Explicit live calendar tests create a real TEST event for the internal address supplied by the server, never the roleplay prospect.", parameters: { type: "object", properties: { slot_id: { type: "string" }, email: { type: "string" }, confirmed: { type: "boolean" } }, required: ["slot_id", "email", "confirmed"] } } },
        ...[
          { name: "request_email_followup", description: "Save an explicitly requested email for human review. This does not send email.", extra: { email: { type: "string" }, confirmed: { type: "boolean" } }, required: ["email", "confirmed"] },
          { name: "schedule_callback", description: "Save an explicitly agreed callback date and timezone. Never infer permission from vague interest.", extra: { start: date, timezone: { type: "string" }, confirmed: { type: "boolean" } }, required: ["start", "timezone", "confirmed"] },
          { name: "suppress_contact", description: "Immediately suppress voice for stop-calling requests, or all outreach for remove-me requests. Uses the current authenticated call's contact.", extra: { scope: { type: "string", enum: ["voice", "all"] } }, required: ["scope"] },
          { name: "request_human_followup", description: "Save an actionable human task. Use category decline to stop the current sequence, wrong_number to hold voice, referral to record a correction, question for unknown details, or suppression_failure for an urgent opt-out problem.", extra: { category: { type: "string", enum: ["question", "decline", "wrong_number", "referral", "suppression_failure"] } }, required: ["category"] },
        ].map(item => ({ type: "function", messages: [{ type: "request-start", content: "" }], function: { name: item.name, description: item.description, parameters: { type: "object", properties: { reason: { type: "string" }, expressed_words: { type: "string", description: "Actual prospect words supporting this request" }, ...item.extra }, required: ["reason", "expressed_words", ...item.required] } } })),
        { type: "transferCall", destinations: [{ type: "number", number: VOICE_BOOKING.transferNumber, description: "Transfer to Josh only after the caller asks to speak with a person and agrees. Never transfer a test call already connected to Josh's own number.", message: "I'll try connecting you with Josh now.", transferPlan: { mode: "blind-transfer" } }] },
        { type: "endCall" },
      ],
    },
    server: { url: callback, headers: { Authorization: `Bearer ${secret}` } },
    serverMessages: ["tool-calls", "end-of-call-report"],
  };
}
