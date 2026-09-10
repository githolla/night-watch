import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({
  channel: z.enum(["linkedin_comment", "linkedin_request", "linkedin_message", "email", "intro_ask"]),
  body: z.string().max(5000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = input.parse(await request.json());
    const db = admin();
    const { data: card } = await db.from("cards").select("person_id,assigned_to,status,active_variant_id,people(do_not_contact),accounts(status)").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    if (!['approved', 'edited', 'sent', 'replied', 'positive', 'meeting'].includes(card.status)) throw new Error("Approve the dossier before recording outreach");
    const person = card.people as unknown as { do_not_contact: boolean };
    const account = card.accounts as unknown as { status: string };
    if (person.do_not_contact || ["client", "do_not_contact"].includes(account.status)) throw new Error("Do-not-contact guard blocked this action");

    const owner = user.email?.startsWith("jenna") ? "jenna" : "josh";
    const limits: Record<string, number> = { linkedin_request: 15, linkedin_comment: 10 };
    if (limits[body.channel]) {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { count } = await db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", body.channel).gte("sent_at", since.toISOString());
      if ((count ?? 0) >= limits[body.channel]) throw new Error("Daily LinkedIn action limit reached");
    }

    const { data, error } = await db.from("touches").insert({
      card_id: id,
      person_id: card.person_id,
      channel: body.channel,
      body: body.body,
      sent_at: new Date().toISOString(),
      sent_by: owner,
      experiment_variant_id: card.active_variant_id ?? null,
    }).select().single();
    if (error) throw error;
    await db.from("cards").update({ status: "sent" }).eq("id", id);
    if (card.active_variant_id) {
      const { data: variant } = await db.from("message_variants").select("experiment_id").eq("id", card.active_variant_id).maybeSingle();
      if (variant) await db.from("message_experiments").update({ status: "sent" }).eq("id", variant.experiment_id);
    }
    return Response.json(data);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Touch failed" }, { status: 400 });
  }
}
