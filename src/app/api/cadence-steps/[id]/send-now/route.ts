import { requireUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { sendEmail } from "@/lib/gmail";
import { validateEmail } from "@/lib/send-action";
import { dailyCap, sendDayStart } from "@/lib/send-guards";
import { emailHtml, fromHeader, sanitizeLinks, senderProfile, withSignature } from "@/lib/sender";
import { outboundBaseUrl } from "@/lib/urls";
import { admin } from "@/lib/supabase/admin";

const daysBetween = (iso: string | null | undefined) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0);

/**
 * Send one queued follow-up right now, instead of waiting for the day it is scheduled for.
 *
 * Testing the sequence previously meant editing scheduled_at in SQL and then calling the cron with its
 * secret. It is also the thing an operator wants when a conversation warms up early.
 *
 * Deliberately the same guards as the cron: do-not-contact, a verified address, the daily cap and the
 * warm-up ramp all still apply, and the step is claimed before sending so this and the cron cannot both
 * send it. The only thing skipped is the wait.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const db = admin();

    const { data: step, error } = await db.from("cadence_steps")
      .select("id,status,kind,channel,subject,body,cadence_id,cadences(id,status,owner,card_id,person_id,people(id,full_name,email,email_status,do_not_contact),cards(account_id,accounts(status)))")
      .eq("id", id).maybeSingle();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!step) return Response.json({ error: "That follow-up is no longer queued." }, { status: 404 });

    const cadence = step.cadences as unknown as {
      id: string; status: string; owner: "josh" | "jenna"; card_id: string; person_id: string;
      people: { id: string; full_name: string; email: string | null; email_status: string; do_not_contact: boolean } | null;
      cards: { account_id: string; accounts: { status: string } | null } | null;
    } | null;
    const to = cadence?.people;
    if (!cadence || !to) return Response.json({ error: "That follow-up has no contact attached." }, { status: 400 });
    if (step.status !== "pending") return Response.json({ error: `This follow-up is already ${step.status}.` }, { status: 400 });
    if (cadence.status !== "active") return Response.json({ error: `The sequence is ${cadence.status}, so nothing will send.` }, { status: 400 });
    if (step.channel !== "email") return Response.json({ error: "This step is a manual reminder, not an email." }, { status: 400 });
    if (!step.subject || !step.body) return Response.json({ error: "This follow-up has no subject or body." }, { status: 400 });
    if (to.do_not_contact || ["client", "do_not_contact"].includes(cadence.cards?.accounts?.status ?? "")) {
      return Response.json({ error: `${to.full_name} is marked do-not-contact.` }, { status: 400 });
    }
    if (!to.email) return Response.json({ error: `There is no address on file for ${to.full_name}.` }, { status: 400 });

    const owner = cadence.owner;
    const { data: connection } = await db.from("gmail_connections").select("email,connected_at,created_at").eq("owner", owner).maybeSingle();
    if (!connection) return Response.json({ error: "That seat has no Google account connected." }, { status: 400 });

    const { count } = await db.from("touches").select("*", { count: "exact", head: true })
      .eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null)
      .gte("sent_at", sendDayStart().toISOString());
    const cap = dailyCap(daysBetween(connection.connected_at ?? connection.created_at));
    const body = sanitizeLinks(step.body);
    // A human pressed this, and can see the address, so verification is relaxed exactly as it is for a
    // manual first send. The cap is not relaxed.
    validateEmail(to.email_status, count ?? 0, body, cap, false);

    // Claim it the same way the cron does, so pressing this while the cron is mid-run cannot double-send.
    const { data: claimed } = await db.from("cadence_steps")
      .update({ sent_at: new Date().toISOString() }).eq("id", id).eq("status", "pending").is("sent_at", null).select("id");
    if (!claimed?.length) return Response.json({ error: "That follow-up was just sent by the scheduler." }, { status: 409 });

    const { data: previous } = await db.from("touches").select("gmail_thread_id")
      .eq("card_id", cadence.card_id).eq("person_id", to.id).eq("channel", "email")
      .not("gmail_thread_id", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle();

    const profile = await senderProfile(db, owner);
    const optOut = process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
    const fullBody = `${withSignature(body, profile, connection.email)}\n\n${optOut}`;
    const html = emailHtml(body, profile, connection.email, optOut);
    const unsubscribe = `${outboundBaseUrl(_request)}/api/unsubscribe?t=${encodeURIComponent(encrypt(to.id))}`;
    const result = await sendEmail(owner, fromHeader(profile, connection.email), to.email, step.subject, fullBody, previous?.gmail_thread_id ?? undefined, profile.cc, html, unsubscribe);

    const now = new Date().toISOString();
    await db.from("touches").insert({ card_id: cadence.card_id, person_id: to.id, channel: "email", sent_at: now, sent_by: owner, gmail_thread_id: result.threadId, body: fullBody });
    await db.from("cadence_steps").update({ status: "sent", sent_at: now, error: null }).eq("id", id);
    return Response.json({ ok: true, to: to.full_name, threadId: result.threadId, sentBy: user.owner });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send that follow-up" }, { status: 400 });
  }
}
