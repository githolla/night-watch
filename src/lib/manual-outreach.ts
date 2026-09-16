import { admin } from "@/lib/supabase/admin";
import { ensureFollowupCadence } from "@/lib/followups";
import type { Owner } from "@/lib/types";

export type ManualChannel = "linkedin_comment" | "linkedin_request" | "linkedin_message" | "email" | "intro_ask";
export type RecordedOutcome = "positive" | "neutral" | "objection" | "referral" | "ooo" | "negative" | "meeting";

export async function recordManualTouch(cardId: string, channel: ManualChannel, owner: Owner, body?: string, personId?: string) {
  const db = admin();
  // Plain lookup (no embeds) so a relationship quirk can never masquerade as "card not found".
  const { data: card, error: lookupError } = await db
    .from("cards")
    .select("person_id,account_id,assigned_to,status,email_subject")
    .eq("id", cardId)
    .maybeSingle();
  if (lookupError) throw new Error(`Card lookup failed: ${lookupError.message}`);
  if (!card) throw new Error("Card not found");
  if (["dismissed", "archived"].includes(card.status)) {
    throw new Error("This prospect was dismissed — reopen it before recording outreach.");
  }
  // Log against the contact actually picked on the desk, not the card's default person.
  const targetPersonId = personId ?? card.person_id;
  const { data: person } = await db.from("people").select("first_name,full_name,do_not_contact").eq("id", targetPersonId).maybeSingle();
  const { data: account } = await db.from("accounts").select("name,status").eq("id", card.account_id).maybeSingle();
  if (person?.do_not_contact || ["client", "do_not_contact"].includes(account?.status ?? "")) {
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
    person_id: targetPersonId,
    channel,
    body,
    sent_at: new Date().toISOString(),
    sent_by: owner,
  }).select().single();
  if (error) throw error;
  // Do NOT flip the card to "sent" — a company stays on the desk so its other contacts can still be logged.
  // The card leaves only when the user snoozes/dismisses it or a real reply lands.
  // Once the first touch is out, stand up the next three follow-ups on that channel. Best-effort: never fail the touch.
  try {
    await ensureFollowupCadence(db, {
      cardId,
      personId: targetPersonId,
      owner,
      touchedChannel: channel,
      firstName: person?.first_name || person?.full_name?.split(/\s+/)[0] || "",
      company: account?.name || "",
      baseSubject: (card as { email_subject?: string | null }).email_subject || "",
    });
  } catch { /* follow-ups are a bonus; the touch itself always stands */ }
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
