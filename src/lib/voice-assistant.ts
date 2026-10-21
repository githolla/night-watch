import { z } from "zod";
import { VOICE_BOOKING, VOICE_INSTRUCTIONS } from "./voice-booking.ts";

const callback = "https://night-watch-snowy.vercel.app/api/voice/vapi";
const existingAssistant = z.object({
  id: z.string(),
  model: z.record(z.string(), z.unknown()),
  server: z.object({ url: z.string().optional() }).optional(),
});
const tool = z.object({ type: z.string(), function: z.object({ name: z.string().optional() }).optional() }).passthrough();
const calendarNames = ["nightwatch_availability", "nightwatch_book"];

export function voiceAssistantPayload(value: unknown, secret: string) {
  if (secret.length < 32) throw new Error("Configure a strong VAPI_WEBHOOK_SECRET first.");
  const current = existingAssistant.parse(value);
  if (current.server?.url && current.server.url !== callback) throw new Error("Assistant uses another server integration; review it before replacing it.");
  if (Array.isArray(current.model.toolIds) && current.model.toolIds.length) throw new Error("Assistant has saved tools; review them before replacing its calendar integration.");
  const tools = z.array(tool).parse(current.model.tools ?? []);
  if (tools.some(item => item.type === "function" && !calendarNames.includes(item.function?.name ?? ""))) throw new Error("Assistant has unrelated function tools; review them before changing its callback.");
  const retained = tools.filter(item => !item.type.startsWith("google.calendar.") && !["transferCall", "endCall"].includes(item.type) && !calendarNames.includes(item.function?.name ?? ""));
  const date = { type: "string", description: "ISO 8601 date and time with explicit UTC offset" };
  return {
    name: "Nine-67 | Suuchi",
    firstMessage: "Hi, I'm Nine-67's AI assistant calling for Suuchi. Is now a good time for a quick question?",
    maxDurationSeconds: 300,
    model: {
      ...current.model,
      messages: [{ role: "system", content: VOICE_INSTRUCTIONS }],
      tools: [
        ...retained,
        { type: "function", function: { name: "nightwatch_availability", description: "Find available 30-minute meetings with Suuchi, respecting preferred hours, pickup and 15-minute buffers.", parameters: { type: "object", properties: { start: date, end: date, prospectRequested: { type: "boolean", description: "True only if the prospect explicitly requests a time outside preferred hours" } }, required: ["start", "end", "prospectRequested"] } } },
        { type: "function", function: { name: "nightwatch_book", description: "Create an explicitly confirmed meeting and email its invitation. Rechecks availability. Only confirm success after this tool succeeds.", parameters: { type: "object", properties: { start: date, email: { type: "string" }, confirmed: { type: "boolean" }, prospectRequested: { type: "boolean" } }, required: ["start", "email", "confirmed", "prospectRequested"] } } },
        { type: "transferCall", destinations: [{ type: "number", number: VOICE_BOOKING.transferNumber, description: "Transfer to Josh only after the caller asks to speak with a person and agrees. Never transfer a test call already connected to Josh's own number.", message: "I'll try connecting you with Josh now.", transferPlan: { mode: "blind-transfer" } }] },
        { type: "endCall" },
      ],
    },
    server: { url: callback, headers: { Authorization: `Bearer ${secret}` } },
    serverMessages: ["tool-calls"],
  };
}
