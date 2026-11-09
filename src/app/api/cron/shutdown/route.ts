import { cronAuthorized } from "@/lib/auth";
import { vapiRequest } from "@/lib/vapi";
import { VOICE_BOOKING } from "@/lib/voice-booking";
import { z } from "zod";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const numbers = z.array(z.object({ id: z.string(), number: z.string() })).parse(await vapiRequest("/phone-number"));
    const phone = numbers.find(number => number.number === VOICE_BOOKING.callerNumber);
    if (!phone) return Response.json({ detached: true, reason: "No Nightwatch phone number is linked." });
    await vapiRequest(`/phone-number/${phone.id}`, "PATCH", { assistantId: null, squadId: null });
    const current = z.object({ assistantId: z.string().nullish(), squadId: z.string().nullish() }).parse(await vapiRequest(`/phone-number/${phone.id}`));
    if (current.assistantId || current.squadId) throw new Error("The voice agent is still linked to the phone number.");
    return Response.json({ detached: true, voiceAgentEnabled: false });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider shutdown needs review." }, { status: 503 });
  }
}
