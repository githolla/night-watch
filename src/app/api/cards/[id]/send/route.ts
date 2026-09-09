import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { validateEmail, sendInput } from "@/lib/send-action";
import { admin } from "@/lib/supabase/admin";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const { subject, body } = sendInput.parse(await request.json());
    const db = admin();
    const { data: card } = await db.from("cards").select("*,people(*),accounts(*)").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    if (!["approved", "edited"].includes(card.status)) throw new Error("Approve the card before sending");
    if (card.people.do_not_contact || ["client", "do_not_contact"].includes(card.accounts.status)) throw new Error("Do-not-contact guard blocked this send");
    const owner = user.email?.startsWith("jenna") ? "jenna" : "josh";
    if (owner !== card.assigned_to) throw new Error("Only the assigned owner may send");
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { count } = await db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").gte("sent_at", since.toISOString());
    validateEmail(card.people.email_status, count ?? 0, body);
    const optOut = process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
    const fullBody = `${body.trim()}\n\n${optOut}`;
    const result = await sendEmail(owner, user.email!, card.people.email, subject, fullBody);
    await db.from("touches").insert({ card_id: id, person_id: card.person_id, channel: "email", sent_at: new Date().toISOString(), sent_by: owner, gmail_thread_id: result.threadId, body: fullBody, experiment_variant_id: card.active_variant_id ?? null });
    if (card.active_variant_id) {
      const { data: chosen } = await db.from("message_variants").select("experiment_id").eq("id", card.active_variant_id).maybeSingle();
      if (chosen) await db.from("message_experiments").update({ status: "sent" }).eq("id", chosen.experiment_id);
    }
    await db.from("cards").update({ status: "sent", email_subject: subject, email_body: body }).eq("id", id);
    return Response.json({ ok: true, threadId: result.threadId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: 400 });
  }
}
