import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/gmail";
import { ensureFollowupCadence } from "@/lib/followups";
import { validateEmail, sendInput } from "@/lib/send-action";
import { dailyCap } from "@/lib/send-guards";
import { emailHtml, fromHeader, sanitizeLinks, senderProfile, withSignature } from "@/lib/sender";
import { outboundBaseUrl } from "@/lib/urls";
import { admin } from "@/lib/supabase/admin";

const daysBetween = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const parsed = sendInput.parse(await request.json());
    const subject = parsed.subject;
    // Strip any fabricated/foreign link the sender may have pasted in — only the real homepage may go out.
    const body = sanitizeLinks(parsed.body);
    const db = admin();
    const { data: card } = await db.from("cards").select("*,people(*),accounts(*)").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    // Only a card still in an un-sent working state may be sent. An allowlist (not a denylist) so a card that
    // already replied / booked a meeting / was snoozed can't be re-sent a cold email through the API.
    if (!["new", "approved", "edited"].includes(card.status)) throw new Error(card.status === "sent" ? "This card is already marked sent." : `This card is ${card.status}, not ready to send.`);
    if (card.people.do_not_contact || ["client", "do_not_contact"].includes(card.accounts.status)) throw new Error("Do-not-contact guard blocked this send");
    // Idempotency: if an email touch is already logged for this card, don't send again even if a prior
    // status write failed — the card's own status guard alone isn't enough to prevent a duplicate send.
    const { count: alreadySent } = await db.from("touches").select("*", { count: "exact", head: true }).eq("card_id", id).eq("channel", "email").not("gmail_thread_id", "is", null);
    if ((alreadySent ?? 0) > 0) throw new Error("An email to this contact is already logged for this card.");
    // Send from the signed-in user's own seat (their connected Google account).
    const owner = user.owner;
    // Send AS the seat's connected mailbox, not the app user's login email — otherwise Gmail rewrites
    // or rejects the From when a teammate's login differs from the connected Google account.
    const { data: connection } = await db.from("gmail_connections").select("email,connected_at,created_at").eq("owner", owner).maybeSingle();
    const since = new Date(); since.setHours(0, 0, 0, 0);
    // Count every email touch from this seat today toward the daily cap — including manual "Mark sent"
    // logs, which are real sends from the mailbox and must count for the warmup ramp to protect the domain.
    const { count } = await db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").gte("sent_at", since.toISOString());
    // Warm the mailbox up gently: the daily cap starts low on a freshly connected seat and ramps to the base.
    const cap = dailyCap(daysBetween(connection?.connected_at ?? connection?.created_at));
    // Manual desk send: a human chose to send and is warned in the UI when the address isn't verified, so
    // the verified requirement is relaxed here (the automated cadence still enforces it).
    validateEmail(card.people.email_status, count ?? 0, body, cap, false);
    const profile = await senderProfile(db, owner);
    const fromEmail = connection?.email ?? user.email ?? "";
    const optOut = process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
    const fullBody = `${withSignature(body, profile, fromEmail)}\n\n${optOut}`;
    // Send multipart/alternative: a plain-text part (spam filters prefer it) AND an HTML part carrying the
    // branded signature, so the sender's signature actually renders in the recipient's client.
    const html = emailHtml(body, profile, fromEmail, optOut);
    const base = outboundBaseUrl(request);
    const unsubscribe = `${base}/api/unsubscribe?t=${encodeURIComponent(encrypt(card.person_id))}`;
    const result = await sendEmail(owner, fromHeader(profile, fromEmail), card.people.email, subject, fullBody, undefined, profile.cc, html, unsubscribe);
    // The email has now actually left. Mark the card sent FIRST so it can never stay actionable after a
    // real send (which is how a "failed" toast used to lead to a duplicate re-send). Only then log to
    // History; if that write fails, the send still stands — we report success with a soft warning.
    await db.from("cards").update({ status: "sent", email_subject: subject, email_body: body }).eq("id", id);
    const { error: touchError } = await db.from("touches").insert({ card_id: id, person_id: card.person_id, channel: "email", sent_at: new Date().toISOString(), sent_by: owner, gmail_thread_id: result.threadId, body: fullBody, experiment_variant_id: card.active_variant_id ?? null });
    if (touchError) return Response.json({ ok: true, threadId: result.threadId, warning: `Sent to ${card.people.full_name}, but saving it to History failed (${touchError.message}). It won't need re-sending.` });
    // Schedule the follow-up cadence off this first touch (idempotent, best-effort — a failure here never
    // undoes the send).
    try {
      await ensureFollowupCadence(db, {
        cardId: id, personId: card.person_id, owner, touchedChannel: "email",
        firstName: (card.people.full_name ?? "").trim().split(/\s+/)[0] || "there",
        company: card.accounts?.name ?? "", baseSubject: subject,
      });
    } catch { /* follow-up scheduling is best-effort */ }
    return Response.json({ ok: true, threadId: result.threadId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: 400 });
  }
}
