import { requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { outreachDelivery } from "@/lib/outreach-ending";
import { fromHeader, senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

const input = z.object({ to: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")) });

/** Send a sample outreach email from the seat's connected mailbox, so the sender can see exactly how a live
 *  send looks (From line, signature, formatting) before sending to real prospects. It goes to the address
 *  typed in, else to the admin acting as this seat, else back to the mailbox itself. Gmail files a message
 *  the API sends to its own mailbox under Sent only, so a self-test never shows in the inbox; the reply says
 *  so. The body is fixed test text, so the verified-recipient guard doesn't apply. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const owner = user.owner;
    const db = admin();
    const { data: conn } = await db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle();
    if (!conn?.email) throw new Error("Connect this seat's Google account first (Settings → Connect Google), then send a test.");
    const mailbox = (conn.email as string).toLowerCase();
    const parsed = input.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new Error("Enter one valid email address to send the test to.");
    const to = parsed.data.to || user.actor?.email?.toLowerCase() || mailbox;

    const profile = await senderProfile(db, owner);
    const first = (profile.fromName || user.name || "there").trim().split(/\s+/)[0];
    const subject = "Night Watch test — here's how your outreach will look";
    const body =
      `Hi ${first},\n\n` +
      `This is a test send from Night Watch. Nothing went to a real prospect.\n\n` +
      `A live email would open with a short, personal line about the company you're reaching, then your signature below. ` +
      `If this arrived and the From line and signature look right, you're ready to send for real.`;
    // The same ending a real send gets: name, signature and the postal address footer.
    const { text: fullBody, html } = outreachDelivery(body, profile);
    const result = await sendEmail(owner, fromHeader(profile, mailbox), to, subject, fullBody, undefined, undefined, html);
    return Response.json({ ok: true, to, from: mailbox, toSelf: to === mailbox, threadId: result.threadId });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Test send failed" }, { status: 400 });
  }
}
