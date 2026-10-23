import { cronAuthorized } from "@/lib/auth";
import { prepareVoiceQueue } from "@/lib/voice-queue";
import { dispatchVoicePilot } from "@/lib/voice-dispatch";

export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const queue = await prepareVoiceQueue();
    const dispatch = await dispatchVoicePilot();
    return Response.json({ queue, dispatch });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Voice pilot held for review." }, { status: 503 });
  }
}
