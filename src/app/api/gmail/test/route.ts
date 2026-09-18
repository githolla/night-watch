import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { emailHtml, fromHeader, senderProfile, withSignature } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";

/** Send a sample outreach email to the signed-in user's own connected mailbox, so they can see exactly
 *  how a live send looks (From line, signature, formatting) before sending to real prospects. Goes only
 *  to their own address, so the verified-recipient guard doesn't apply. */
export async function POST() {
  try {
    const user = await requireUser();
    const owner = user.owner;
    const db = admin();
    const { data: conn } = await db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle();
    if (!conn?.email) throw new Error("Connect this seat's Google account first (Settings → Connect Google), then send a test.");
    const to = conn.email as string;

    const profile = await senderProfile(db, owner);
    const first = (profile.fromName || user.name || "there").trim().split(/\s+/)[0];
    const subject = "Night Watch test — here's how your outreach will look";
    const body =
      `Hi ${first},\n\n` +
      `This is a test send from Night Watch to your own inbox — nothing went to a real prospect.\n\n` +
      `A live email would open with a short, personal line about the company you're reaching, then your signature below. ` +
      `If this arrived and the From line and signature look right, you're ready to send for real.`;
    const fullBody = withSignature(body, profile, to);
    const html = emailHtml(body, profile, to, "");
    const result = await sendEmail(owner, fromHeader(profile, to), to, subject, fullBody, undefined, undefined, html);
    return Response.json({ ok: true, to, threadId: result.threadId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Test send failed" }, { status: 400 });
  }
}
