import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ owner: z.enum(["josh", "jenna"]).default("josh") });

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const { owner: requested } = input.parse(await request.json().catch(() => ({})));
    // A member can only disconnect their own seat; only an admin may disconnect the other seat. Reject a
    // cross-seat request outright rather than silently remapping it to the caller's seat (which would show
    // "disconnected" while quietly killing the wrong mailbox).
    if (user.role !== "admin" && requested !== user.owner) {
      return Response.json({ error: "You can only disconnect your own seat." }, { status: 403 });
    }
    await admin().from("gmail_connections").delete().eq("owner", requested);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Disconnect failed" }, { status: 400 });
  }
}
