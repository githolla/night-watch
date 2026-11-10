import { cronAuthorized } from "@/lib/auth";
import { vapiRequest } from "@/lib/vapi";
import { VOICE_BOOKING } from "@/lib/voice-booking";
import { z } from "zod";
import { admin } from "@/lib/supabase/admin";
import { postSlackMessage } from "@/lib/slack";

export async function POST(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = z.object({ announce: z.boolean().optional() }).parse(await request.json().catch(() => ({})));
    const numbers = z.array(z.object({ id: z.string(), number: z.string() })).parse(await vapiRequest("/phone-number"));
    const phone = numbers.find(number => number.number === VOICE_BOOKING.callerNumber);
    if (phone) {
      await vapiRequest(`/phone-number/${phone.id}`, "PATCH", { assistantId: null, squadId: null });
      const current = z.object({ assistantId: z.string().nullish(), squadId: z.string().nullish() }).parse(await vapiRequest(`/phone-number/${phone.id}`));
      if (current.assistantId || current.squadId) throw new Error("The voice agent is still linked to the phone number.");
    }
    let announced = false;
    if (input.announce) {
      const claim = await admin().from("seat_notifications").insert({ owner: "josh", kind: "nightwatch-shutdown", key: "operator-shutdown-2026-11-09" });
      if (claim.error?.code === "23505") return Response.json({ detached: true, announcement: "Already posted or delivery requires reconciliation" });
      if (claim.error) throw new Error("Could not reserve the shutdown announcement.");
      announced = await postSlackMessage("*Nightwatch is turned off completely at Josh’s request.*\n\n• Automated emails and follow-up cadences are stopped.\n• Pending calls are cancelled, and Alex is detached from the phone number.\n• All scheduled jobs, research, and automated Slack notifications are disabled.\n• The site and API actions are disabled.\n\nCompany records and outreach history are preserved. Nightwatch will remain off unless Josh explicitly requests a restart.");
      if (!announced) throw new Error("The shutdown announcement was not confirmed. Nightwatch remains off.");
    }
    return Response.json({ detached: true, voiceAgentEnabled: false, announced });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Provider shutdown needs review." }, { status: 503 });
  }
}
