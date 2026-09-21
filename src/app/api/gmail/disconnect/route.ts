import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ owner: z.enum(["josh", "jenna"]).default("josh") });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { owner: requested } = input.parse(await request.json().catch(() => ({})));
    // A member can only disconnect their own seat's mailbox; only an admin may disconnect the other seat.
    const owner = user.role === "admin" ? requested : user.owner;
    await admin().from("gmail_connections").delete().eq("owner", owner);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Disconnect failed" }, { status: 400 });
  }
}
