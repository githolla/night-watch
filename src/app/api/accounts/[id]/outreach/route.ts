import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { isOutreachStage, STAGE_ORDER } from "@/lib/outreach";
import { admin } from "@/lib/supabase/admin";

const update = z.object({
  outreach_stage: z.string().refine(isOutreachStage, { message: `Stage must be one of ${STAGE_ORDER.join(", ")}` }).optional(),
  outreach_owner: z.string().trim().max(60).nullable().optional(),
  outreach_notes: z.string().max(4000).nullable().optional(),
  /** true or false decides by hand; null goes back to whatever the tier says. */
  outreach: z.boolean().nullable().optional(),
});

/** Move a company's stage, owner, notes, or reach-out membership. Every change is stamped. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const body = update.parse(await request.json());
    const db = admin();
    const payload: Record<string, unknown> = { outreach_updated_at: new Date().toISOString() };
    if (body.outreach_stage !== undefined) payload.outreach_stage = body.outreach_stage;
    if (body.outreach_owner !== undefined) payload.outreach_owner = body.outreach_owner || null;
    if (body.outreach_notes !== undefined) payload.outreach_notes = body.outreach_notes || null;
    if (body.outreach !== undefined) {
      if (body.outreach === null) {
        const { data: current, error } = await db.from("accounts").select("tier").eq("id", id).single();
        if (error) throw error;
        payload.outreach = current.tier === "A1" || current.tier === "A2";
        payload.outreach_manual = null;
      } else {
        payload.outreach = body.outreach;
        payload.outreach_manual = body.outreach;
      }
    }
    const { data, error } = await db.from("accounts").update(payload).eq("id", id).select("id,domain,outreach,outreach_manual,outreach_stage,outreach_owner,outreach_notes,outreach_updated_at,tier").single();
    if (error) throw error;
    if (payload.outreach === false) {
      // Off the list means no open dossier waits on the desk for it.
      await db.from("cards").update({ status: "archived", dismiss_reason: "Taken off the reach-out list by hand." }).eq("account_id", id).in("status", ["new", "approved", "edited", "snoozed"]);
    }
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
