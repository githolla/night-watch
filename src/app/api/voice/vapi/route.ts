import { voiceStructuredResult } from "@/lib/voice-analysis";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { boundVoiceAttempt, executeVoiceTool, saveVoiceReport } from "@/lib/voice-runtime";

export const runtime = "nodejs";
export const maxDuration = 60;
const call = z.object({ id: z.string().min(1), assistantId: z.string().min(1) });
const toolMessage = z.object({ type: z.literal("tool-calls"), call, toolCallList: z.array(z.object({ id: z.string().min(1), function: z.object({ name: z.string(), arguments: z.unknown() }) })).min(1).max(8) });
const reportMessage = z.object({ type: z.literal("end-of-call-report"), call, endedReason: z.string().max(1000).optional(), transcript: z.string().max(200_000).optional(), analysis: z.unknown().optional(), artifact: z.object({ transcript: z.string().max(200_000).optional(), structuredOutputs: z.record(z.string(), z.object({ name: z.string().optional(), result: z.unknown().optional() })).optional() }).optional() });
const envelope = z.object({ message: z.discriminatedUnion("type", [toolMessage, reportMessage]) });

export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  const assistant = process.env.VAPI_ASSISTANT_ID;
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || !assistant || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = envelope.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid voice request" }, { status: 400 });
  const { message } = parsed.data;
  if (message.call.assistantId !== assistant) return Response.json({ error: "Unknown assistant" }, { status: 403 });
  try {
    const attempt = await boundVoiceAttempt(message.call.id);
    if (message.type === "end-of-call-report") {
      const structured = voiceStructuredResult(message.artifact);
      await saveVoiceReport(attempt, { endedReason: message.endedReason, transcript: message.transcript ?? message.artifact?.transcript, analysis: structured });
      return Response.json({ ok: true });
    }
    const results = [];
    for (const tool of message.toolCallList) {
      let result: unknown;
      try {
        const args: unknown = typeof tool.function.arguments === "string" ? JSON.parse(tool.function.arguments) : tool.function.arguments;
        result = { success: true, ...await executeVoiceTool(attempt, tool.id, tool.function.name, args) };
      } catch (error) {
        result = { success: false, error: error instanceof Error ? error.message : "Voice action failed" };
      }
      results.push({ name: tool.function.name, toolCallId: tool.id, result: JSON.stringify(result) });
    }
    return Response.json({ results });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not process voice event" }, { status: 409 });
  }
}
