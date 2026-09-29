import { requireUser } from "@/lib/auth";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ on: z.boolean(), expected_updated_at:z.string().optional() });

/**
 * Mark a prospect as being worked (or clear it), so the other person on the desk sees it and doesn't message
 * the same person. Best-effort: it's a shared flag, not a hard lock.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { on, expected_updated_at } = input.parse(await request.json());
    const db = admin();
    const by = on ? (await senderProfile(db, user.owner)).fromName || null : null;
    let query = db.from("cards").update({ working_at: on ? new Date().toISOString() : null, working_by: by }).eq("id", id);
    if(expected_updated_at)query=query.eq("updated_at",expected_updated_at);
    const {data,error}=await query.select("updated_at").maybeSingle();
    if(!error&&!data)return Response.json({error:"Draft changed. Reload before claiming it."},{status:409});
    if(error)throw error;
    return Response.json({ ok: true, updated_at:data?.updated_at });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Claim failed" }, { status: 400 });
  }
}
