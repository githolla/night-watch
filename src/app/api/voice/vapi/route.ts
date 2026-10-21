import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { voiceAvailability, voiceBook } from "@/lib/voice-calendar";

export const runtime = "nodejs";
export const maxDuration = 60;
const envelope = z.object({ message: z.object({
  type: z.literal("tool-calls"), call: z.object({ id: z.string().min(1), assistantId: z.string().min(1) }),
  toolCallList: z.array(z.object({ id: z.string().min(1), function: z.object({ name: z.string(), arguments: z.unknown() }) })).min(1).max(8),
}) });
const availability = z.object({ start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), prospectRequested: z.boolean().default(false) });
const booking = z.object({ start: z.string().datetime({ offset: true }), email: z.email(), confirmed: z.boolean(), prospectRequested: z.boolean().default(false) });

export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  const assistant = process.env.VAPI_ASSISTANT_ID;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || !assistant || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = envelope.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid tool request" }, { status: 400 });
  const { message } = parsed.data;
  if (message.call.assistantId !== assistant) return Response.json({ error: "Unknown assistant" }, { status: 403 });
  const results = [];
  for (const tool of message.toolCallList) {
    let result: unknown;
    try {
      const args: unknown = typeof tool.function.arguments === "string" ? JSON.parse(tool.function.arguments) : tool.function.arguments;
      if (tool.function.name === "nightwatch_availability") {
        const input = availability.parse(args);
        result = { success: true, ...await voiceAvailability(input.start, input.end, input.prospectRequested) };
      } else if (tool.function.name === "nightwatch_book") result = { success: true, ...await voiceBook(booking.parse(args), message.call.id) };
      else result = { success: false, error: "Unknown tool" };
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : "Calendar action failed" };
    }
    results.push({ name: tool.function.name, toolCallId: tool.id, result: JSON.stringify(result) });
  }
  return Response.json({ results });
}
