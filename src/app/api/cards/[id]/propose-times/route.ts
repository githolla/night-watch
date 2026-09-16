import { requireUser } from "@/lib/auth";
import { proposeTimes } from "@/lib/calendar";
import { admin } from "@/lib/supabase/admin";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const db = admin();
    const owner = user.owner;
    const { data: connection } = await db.from("gmail_connections").select("calendar").eq("owner", owner).maybeSingle();
    if (!connection) throw new Error("Connect a Google account in Settings first.");
    if (connection.calendar === false) throw new Error("Calendar wasn't granted — reconnect Google in Settings and allow Calendar.");
    const { slots, timeZone } = await proposeTimes(owner, {});
    if (slots.length === 0) throw new Error("No open times found in the next week — try widening your calendar.");
    // Remember what we offered so a reply can be matched to one of these and the invite booked automatically.
    await db.from("cards").update({ proposed_times: { timeZone, slots } }).eq("id", id);
    return Response.json({ ok: true, slots, timeZone });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not propose times" }, { status: 400 });
  }
}
