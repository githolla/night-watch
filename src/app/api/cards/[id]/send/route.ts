import { assertListSender } from "@/lib/focus-data";
import { firstTouchErrors } from "@/lib/first-touch";
import { authoredSenderDraft } from '@/lib/authored-sender';
import { trackEmailVersion } from "@/lib/version-tracking";
import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/gmail";
import { ensureFollowupCadence } from "@/lib/followups";
import { validateEmail, sendInput } from "@/lib/send-action";
import { dailyCap, sendDayStart } from "@/lib/send-guards";
import { fromHeader, sanitizeLinks, senderProfile } from "@/lib/sender";
import { outboundBaseUrl } from "@/lib/urls";
import { admin } from "@/lib/supabase/admin";
import { isCuratedDomain } from "@/lib/curated-worklist";
import { outreachBody, outreachDelivery } from "@/lib/outreach-ending";

const daysBetween = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const parsed = sendInput.parse(await request.json());
    const subject = parsed.subject;
    // Strip any fabricated/foreign link the sender may have pasted in — only the real homepage may go out.
    let body = sanitizeLinks(parsed.body);
    const db = admin();
    const { data: card } = await db.from("cards").select("*,people(*),accounts(*)").eq("id", id).single();
    if (!card) throw new Error("Card not found");
    assertListSender(card.accounts?.domain, user.owner);
    const curated = isCuratedDomain(card.accounts?.domain);
    if (curated) body = outreachBody(body);
    // Only a card still in an un-sent working state may be sent. An allowlist (not a denylist) so a card that
    // already replied / booked a meeting / was snoozed can't be re-sent a cold email through the API.
    // A card is marked sent the moment its first email goes out, but a company has more than one person
    // on it. Writing to a COLLEAGUE afterwards is normal work and must not be blocked — the per-person
    // guard below is what stops the same contact being emailed twice. Every other status still stops here.
    const writingToColleague = Boolean(parsed.personId && parsed.personId !== card.person_id);
    const sendable = writingToColleague ? ["new", "approved", "edited", "sent"] : ["new", "approved", "edited"];
    if (!sendable.includes(card.status)) throw new Error(card.status === "sent" ? "This card is already marked sent." : `This card is ${card.status}, not ready to send.`);
    // The recipient is the card's own contact unless the desk picked a colleague from the company's team
    // list. That person must be at the SAME company: the id arrives from the browser, so without this check
    // any person in the database could be emailed through someone else's card.
    let recipient = card.people as { id: string; full_name: string; email: string | null; email_status: string; do_not_contact: boolean };
    if (parsed.personId && parsed.personId !== card.person_id) {
      const { data: chosen } = await db.from("people").select("id,full_name,email,email_status,do_not_contact,account_id").eq("id", parsed.personId).maybeSingle();
      if (!chosen) throw new Error("That contact is no longer on file.");
      if (chosen.account_id !== card.account_id) throw new Error("That contact works at a different company.");
      recipient = chosen as typeof recipient;
    }
    if (!recipient.email) throw new Error(`There is no email address on file for ${recipient.full_name}.`);
    if (recipient.do_not_contact || ["client", "do_not_contact"].includes(card.accounts.status)) throw new Error("Do-not-contact guard blocked this send");
    // Idempotency: if an email to THIS PERSON is already logged for this card, don't send again even if a
    // prior status write failed. Scoped to the person, not the card, so emailing a second contact at the
    // same company is still possible while a duplicate to the same one is not.
    const { count: alreadySent } = await db.from("touches").select("*", { count: "exact", head: true }).eq("card_id", id).eq("person_id", recipient.id).eq("channel", "email").not("gmail_thread_id", "is", null);
    if ((alreadySent ?? 0) > 0) throw new Error(`An email to ${recipient.full_name} is already logged for this card.`);
    // Send from the signed-in user's own seat (their connected Google account).
    const owner = user.owner;
    // Send AS the seat's connected mailbox, not the app user's login email — otherwise Gmail rewrites
    // or rejects the From when a teammate's login differs from the connected Google account.
    const { data: connection } = await db.from("gmail_connections").select("email,connected_at,created_at").eq("owner", owner).maybeSingle();
    // Midnight where the operator is, not on the server — see sendDayStart.
    const since = sendDayStart();
    // Count only touches that actually left through Gmail (they carry a thread id). "Copy" also writes an
    // email touch, and counting those meant four copies on a fresh mailbox (cap 4) blocked every real send
    // before a single email had gone out.
    const { count } = await db.from("touches").select("*", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", since.toISOString());
    // Warm the mailbox up gently: the daily cap starts low on a freshly connected seat and ramps to the base.
    const cap = dailyCap(daysBetween(connection?.connected_at ?? connection?.created_at));
    // Manual desk send: a human chose to send and is warned in the UI when the address isn't verified, so
    // the verified requirement is relaxed here (the automated cadence still enforces it).
    const savedProfile = await senderProfile(db, owner);
    const profile = savedProfile;
    const personalized = authoredSenderDraft({ body, domain: card.accounts?.domain, contactName: recipient.full_name, senderName: profile.fromName, greeting: profile.greeting });
    if (personalized.senderConflict) throw new Error(personalized.senderConflict);
    body = personalized.body;
    const copyErrors = firstTouchErrors(subject, body);
    if(copyErrors.length) throw new Error(copyErrors.join(" "));
    validateEmail(recipient.email_status, count ?? 0, body, cap, false);
    const fromEmail = connection?.email ?? user.email ?? "";
    const optOut = process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
    const delivery = outreachDelivery(body, profile);
    const fullBody = delivery.text + (curated ? "" : `\n\n${optOut}`);
    // Send multipart/alternative: a plain-text part (spam filters prefer it) AND an HTML part carrying the
    // branded signature, so the sender's signature actually renders in the recipient's client.
    const html = delivery.html + (curated ? "" : `<p>${optOut.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>`);
    const base = outboundBaseUrl(request);
    const unsubscribe = `${base}/api/unsubscribe?t=${encodeURIComponent(encrypt(recipient.id))}`;
    const versionId = await trackEmailVersion(db, { cardId: id, personId: recipient.id, owner, subject, body: fullBody, source: "gmail" });
    const deliveredBody = fullBody;
    const result = await sendEmail(owner, fromHeader(profile, fromEmail), recipient.email, subject, deliveredBody, undefined, profile.cc, html, unsubscribe);
    // The email has now actually left. Mark the card sent FIRST so it can never stay actionable after a
    // real send (which is how a "failed" toast used to lead to a duplicate re-send). Only then log to
    // History; if that write fails, the send still stands — we report success with a soft warning.
    // Only overwrite the stored draft when it was the card's own contact being written to. A colleague's
    // copy carries their name, and saving it would rewrite the primary contact's draft with it.
    const cardPatch: Record<string, unknown> = recipient.id === card.person_id
      ? { status: "sent", email_subject: subject, email_body: body }
      : { status: "sent", email_subject: subject };
    await db.from("cards").update(cardPatch).eq("id", id);
    const { error: touchError } = await db.from("touches").insert({ card_id: id, person_id: recipient.id, channel: "email", sent_at: new Date().toISOString(), sent_by: owner, gmail_thread_id: result.threadId, body: deliveredBody, experiment_variant_id: versionId });
    if (touchError) return Response.json({ ok: true, threadId: result.threadId, warning: `Sent to ${recipient.full_name}, but saving it to History failed (${touchError.message}). It won't need re-sending.` });
    // Schedule the follow-up cadence off this first touch (idempotent, best-effort — a failure here never
    // undoes the send).
    try {
      await ensureFollowupCadence(db, {
        cardId: id, personId: recipient.id, owner, touchedChannel: "email",
        firstName: (recipient.full_name ?? "").trim().split(/\s+/)[0] || "there",
        company: card.accounts?.name ?? "", baseSubject: subject,
      });
    } catch { /* follow-up scheduling is best-effort */ }
    return Response.json({ ok: true, threadId: result.threadId, to: recipient.full_name });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Send failed" }, { status: 400 });
  }
}
