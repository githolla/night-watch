import { requireUser } from "@/lib/auth";
import { simulateMessages } from "@/lib/agents";
import { simulateHeuristically } from "@/lib/message-simulation";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const variant = z.object({ label: z.enum(["A", "B"]), subject: z.string().max(120), body: z.string().min(1).max(1000) });
const simulationInput = z.object({
  channel: z.enum(["comment", "connection", "email"]),
  personName: z.string().min(1).max(120),
  company: z.string().min(1).max(160),
  signalSummary: z.string().min(1).max(1000),
  goal: z.string().min(1).max(240),
  context: z.string().max(1500),
  focusAreas: z.array(z.string().min(1).max(120)).max(5),
  variants: z.tuple([variant, variant]),
});
const selectionInput = z.object({ experimentId: z.uuid(), label: z.enum(["A", "B"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = simulationInput.parse(await request.json());
    const db = admin();
    const { data: ownerCard } = await db.from("cards").select("id,person_id,assigned_to").eq("id", id).single();
    if (!ownerCard) throw new Error("Card not found");
    const owner = user.email?.startsWith("jenna") ? "jenna" : "josh";
    if (owner !== ownerCard.assigned_to) throw new Error("Only the assigned owner may run this simulation");
    const { data: pastTouches } = await db.from("touches").select("body,reply_classification").eq("sent_by", owner).not("experiment_variant_id", "is", null).not("reply_at", "is", null).order("reply_at", { ascending: false }).limit(12);
    const outcomeHistory = (pastTouches ?? []).map((touch) => `${touch.reply_classification}: ${(touch.body ?? "").replace(/\s+/g, " ").slice(0, 220)}`).join("\n");
    const calibratedInput = { ...input, outcomeHistory };

    let result;
    try {
      result = process.env.ANTHROPIC_API_KEY ? await simulateMessages(calibratedInput) : simulateHeuristically(calibratedInput);
    } catch {
      result = simulateHeuristically(calibratedInput);
    }

    const { data: experiment } = await db.from("message_experiments").insert({
      card_id: id,
      person_id: ownerCard.person_id,
      owner: ownerCard.assigned_to,
      channel: input.channel,
      goal: input.goal,
      context: input.context,
      focus_areas: input.focusAreas,
      status: "simulated",
      predicted_winner: result.winner,
      confidence: result.confidence,
      model: result.model ?? "heuristic-room-v1",
    }).select("id").maybeSingle();

    if (experiment) {
      await db.from("message_variants").insert(result.variants.map((item) => ({
        experiment_id: experiment.id,
        label: item.label,
        subject: item.subject,
        body: item.body,
        simulation_score: item.score,
        dimensions: item.dimensions,
        panel: result.panel.filter((reaction) => reaction.vote === item.label),
      })));
    }
    return Response.json({ ...result, experimentId: experiment?.id ?? null, outcomesUsed: pastTouches?.length ?? 0 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Simulation failed" }, { status: 400 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const input = selectionInput.parse(await request.json());
    const db = admin();
    const { data: card } = await db.from("cards").select("id,assigned_to").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    const owner = user.email?.startsWith("jenna") ? "jenna" : "josh";
    if (owner !== card.assigned_to) throw new Error("Only the assigned owner may choose a winner");
    const { data: experiment } = await db.from("message_experiments").select("id,channel").eq("id", input.experimentId).eq("card_id", id).single();
    if (!experiment) throw new Error("Experiment not found");
    const { data: selected } = await db.from("message_variants").select("id,subject,body").eq("experiment_id", experiment.id).eq("label", input.label).single();
    if (!selected) throw new Error("Variant not found");
    await db.from("message_variants").update({ selected: false }).eq("experiment_id", experiment.id);
    await db.from("message_variants").update({ selected: true }).eq("id", selected.id);
    await db.from("message_experiments").update({ status: "selected", selected_label: input.label }).eq("id", experiment.id);
    const copy = experiment.channel === "email" ? { email_subject: selected.subject, email_body: selected.body } : experiment.channel === "comment" ? { linkedin_comment: selected.body } : { linkedin_note: selected.body };
    await db.from("cards").update({ ...copy, active_variant_id: selected.id, status: "edited" }).eq("id", id);
    return Response.json({ ok: true, variantId: selected.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Selection failed" }, { status: 400 });
  }
}
