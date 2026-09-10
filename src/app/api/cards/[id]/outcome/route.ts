import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ outcome: z.enum(["positive", "neutral", "objection", "referral", "ooo", "negative", "meeting"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const { outcome } = input.parse(await request.json());
    const db = admin();
    const { data: touch } = await db.from("touches").select("id,experiment_variant_id").eq("card_id", id).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (!touch) throw new Error("Record an outreach touch before adding an outcome");

    const classification = outcome === "meeting" ? "positive" : outcome;
    const cardStatus = outcome === "meeting" ? "meeting" : ["positive", "referral"].includes(outcome) ? "positive" : "replied";
    const replyAt = new Date().toISOString();
    const { error } = await db.from("touches").update({ reply_at: replyAt, reply_classification: classification }).eq("id", touch.id);
    if (error) throw error;
    await db.from("cards").update({ status: cardStatus }).eq("id", id);

    if (touch.experiment_variant_id) {
      const { data: variant } = await db.from("message_variants").select("experiment_id").eq("id", touch.experiment_variant_id).maybeSingle();
      if (variant) await db.from("message_experiments").update({ status: "completed" }).eq("id", variant.experiment_id);
    }
    const { data: cadence } = await db.from("cadences").select("id").eq("card_id", id).eq("status", "active").maybeSingle();
    if (cadence) {
      await db.from("cadences").update({ status: "stopped", completed_at: replyAt }).eq("id", cadence.id);
      await db.from("cadence_steps").update({ status: "skipped" }).eq("cadence_id", cadence.id).eq("status", "pending");
    }
    return Response.json({ ok: true, status: cardStatus, outcome });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Outcome failed" }, { status: 400 });
  }
}
