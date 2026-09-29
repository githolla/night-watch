import { requireUser } from "@/lib/auth";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ on: z.boolean() });

/**
 * Mark a prospect as being worked (or clear it), so the other person on the desk sees it and doesn't message
 * the same person. Best-effort: it's a shared flag, not a hard lock.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { on } = input.parse(await request.json());
    const db = admin();
    const by = on ? (await senderProfile(db, user.owner)).fromName || null : null;
    const {data,error} = await db.from("cards").update({ working_at: on ? new Date().toISOString() : null, working_by: by }).eq("id", id).select("updated_at").single();
    if(error)throw error;
    return Response.json({ ok: true, updated_at:data.updated_at });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Claim failed" }, { status: 400 });
  }
}
