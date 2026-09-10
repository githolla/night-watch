import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export type ManualChannel = "linkedin_comment" | "linkedin_request" | "linkedin_message" | "email" | "intro_ask";
export type RecordedOutcome = "positive" | "neutral" | "objection" | "referral" | "ooo" | "negative" | "meeting";

export async function recordManualTouch(cardId: string, channel: ManualChannel, owner: Owner, body?: string) {
  const db = admin();
  const { data: card } = await db
    .from("cards")
    .select("person_id,assigned_to,status,active_variant_id,people(do_not_contact),accounts(status)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("Card not found");
  if (!["approved", "edited", "sent", "replied", "positive", "meeting"].includes(card.status)) {
    throw new Error("Approve the dossier before recording outreach");
  }
  const person = card.people as unknown as { do_not_contact: boolean };
  const account = card.accounts as unknown as { status: string };
  if (person.do_not_contact || ["client", "do_not_contact"].includes(account.status)) {
    throw new Error("Do-not-contact guard blocked this action");
  }

  const limits: Partial<Record<ManualChannel, number>> = { linkedin_request: 15, linkedin_comment: 10 };
  if (limits[channel]) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { count } = await db
      .from("touches")
      .select("*", { count: "exact", head: true })
      .eq("sent_by", owner)
      .eq("channel", channel)
      .gte("sent_at", since.toISOString());
    if ((count ?? 0) >= limits[channel]!) throw new Error("Daily LinkedIn action limit reached");
  }

  const { data, error } = await db.from("touches").insert({
    card_id: cardId,
    person_id: card.person_id,
    channel,
    body,
    sent_at: new Date().toISOString(),
    sent_by: owner,
    experiment_variant_id: card.active_variant_id ?? null,
  }).select().single();
  if (error) throw error;
  await db.from("cards").update({ status: "sent" }).eq("id", cardId);
  if (card.active_variant_id) {
    const { data: variant } = await db.from("message_variants").select("experiment_id").eq("id", card.active_variant_id).maybeSingle();
    if (variant) await db.from("message_experiments").update({ status: "sent" }).eq("id", variant.experiment_id);
  }
  return data;
}

export async function recordCardOutcome(cardId: string, outcome: RecordedOutcome) {
  const db = admin();
  const { data: touch } = await db
    .from("touches")
    .select("id,experiment_variant_id")
    .eq("card_id", cardId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!touch) throw new Error("Record an outreach touch before adding an outcome");

  const classification = outcome === "meeting" ? "positive" : outcome;
  const cardStatus = outcome === "meeting" ? "meeting" : ["positive", "referral"].includes(outcome) ? "positive" : "replied";
  const replyAt = new Date().toISOString();
  const { error } = await db.from("touches").update({ reply_at: replyAt, reply_classification: classification }).eq("id", touch.id);
  if (error) throw error;
  await db.from("cards").update({ status: cardStatus }).eq("id", cardId);

  if (touch.experiment_variant_id) {
    const { data: variant } = await db.from("message_variants").select("experiment_id").eq("id", touch.experiment_variant_id).maybeSingle();
    if (variant) await db.from("message_experiments").update({ status: "completed" }).eq("id", variant.experiment_id);
  }
  const { data: cadence } = await db.from("cadences").select("id").eq("card_id", cardId).eq("status", "active").maybeSingle();
  if (cadence) {
    await db.from("cadences").update({ status: "stopped", completed_at: replyAt }).eq("id", cadence.id);
    await db.from("cadence_steps").update({ status: "skipped" }).eq("cadence_id", cadence.id).eq("status", "pending");
  }
  return { ok: true, status: cardStatus, outcome };
}
