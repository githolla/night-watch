import { deliveryReservationId } from "@/lib/delivery-state";
import { requireUser } from "@/lib/auth";
import { recordManualTouch, type ManualChannel } from "@/lib/manual-outreach";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { z } from "zod";

const input = z.object({ action: z.enum(["sent", "skipped"]) });
const MANUAL: ManualChannel[] = ["linkedin_comment", "linkedin_request", "linkedin_message", "email", "intro_ask"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { action } = input.parse(await request.json());
    const db = admin();
    const { data: step } = await db
      .from("cadence_steps")
      .select("id,channel,body,subject,status,sent_at,error,cadences(card_id,owner,person_id)")
      .eq("id", id)
      .single();
    if (!step) throw new Error("Follow-up not found");
    const cadence = step.cadences as unknown as { card_id: string; owner: Owner; person_id: string } | null;

    if (!cadence || cadence.owner !== user.owner) throw new Error("Sign in as the list owner to update delivery status.");
    if (step.status === "sent") return Response.json({ok:true,status:'sent'});
    const manualPending=step.error==='Manual activity pending';
    if(step.sent_at&&!manualPending)throw new Error('Delivery is in progress or uncertain. Use Delivery recovery.');
    if(!['pending','ready','failed'].includes(step.status))throw new Error('This step is no longer actionable.');

    if (action === "skipped") {
      const {data,error} = await db.from("cadence_steps").update({ status: "skipped" }).eq("id", id).in('status',['pending','ready','failed']).is('sent_at',null).select('id');
      if (error) throw error;
      if(!data?.length)throw new Error('This step changed. Reload before skipping.');
      return Response.json({ ok: true, status: "skipped" });
    }

    if(!manualPending){
      const claimed=await db.from('cadence_steps').update({sent_at:new Date().toISOString(),error:'Manual activity pending'}).eq('id',id).in('status',['pending','ready','failed']).is('sent_at',null).select('id');
      if(claimed.error||!claimed.data?.length)throw new Error('This step changed. Reload before recording it.');
    }
    // Marked sent: record it as a real touch (so it shows in history), then close the step.
    if (cadence && MANUAL.includes(step.channel as ManualChannel)) {
      await recordManualTouch(cadence.card_id, step.channel as ManualChannel, cadence.owner, (step.body as string | null) ?? undefined, cadence.person_id, step.subject ?? undefined, true, deliveryReservationId(`manual-step:${id}`,cadence.person_id));
    }
    const {error} = await db.from("cadence_steps").update({ status: "sent", error:null, sent_at: step.sent_at ?? new Date().toISOString() }).eq("id", id);
    if (error) throw error;
    return Response.json({ ok: true, status: "sent" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the follow-up" }, { status: 400 });
  }
}
