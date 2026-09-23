import { requireUser } from "@/lib/auth";
import { recordManualTouch, type ManualChannel } from "@/lib/manual-outreach";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { z } from "zod";

const input = z.object({ action: z.enum(["sent", "skipped"]) });
const MANUAL: ManualChannel[] = ["linkedin_comment", "linkedin_request", "linkedin_message", "email", "intro_ask"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const { action } = input.parse(await request.json());
    const db = admin();
    const { data: step } = await db
      .from("cadence_steps")
      .select("id,channel,body,subject,status,cadences(card_id,owner,person_id)")
      .eq("id", id)
      .single();
    if (!step) throw new Error("Follow-up not found");
    const cadence = step.cadences as unknown as { card_id: string; owner: Owner; person_id: string } | null;

    if (action === "skipped") {
      await db.from("cadence_steps").update({ status: "skipped" }).eq("id", id);
      return Response.json({ ok: true, status: "skipped" });
    }

    // Marked sent: record it as a real touch (so it shows in history), then close the step.
    if (cadence && MANUAL.includes(step.channel as ManualChannel)) {
      await recordManualTouch(cadence.card_id, step.channel as ManualChannel, cadence.owner, (step.body as string | null) ?? undefined, cadence.person_id, step.subject ?? undefined, true);
    }
    await db.from("cadence_steps").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", id);
    return Response.json({ ok: true, status: "sent" });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the follow-up" }, { status: 400 });
  }
}
