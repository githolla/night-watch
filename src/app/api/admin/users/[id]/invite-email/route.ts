import { requireAdmin } from "@/lib/auth";
import { buildInviteEmail } from "@/lib/invite-email";
import { sendEmail } from "@/lib/gmail";
import { fromHeader, senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import { randomBytes } from "node:crypto";
import type { Owner } from "@/lib/types";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Email a teammate their invite link, sent through a connected Google seat.
 *  Reuses a still-valid invite token, or mints a fresh one, then sends. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const me = await requireAdmin();
    const { id } = await context.params;
    const db = admin();

    const { data: user } = await db.from("app_users").select("id,name,email,invite_token,invite_expires_at").eq("id", id).maybeSingle();
    if (!user) throw new Error("That teammate no longer exists.");

    // Reuse a non-expired invite link so re-sending keeps the same URL; otherwise mint a fresh one.
    const stillValid = user.invite_token && (!user.invite_expires_at || Date.parse(user.invite_expires_at as string) > Date.now());
    let token = user.invite_token as string | null;
    if (!stillValid) {
      token = randomBytes(24).toString("base64url");
      const { error } = await db.from("app_users").update({ invite_token: token, invite_expires_at: new Date(Date.now() + INVITE_TTL_MS).toISOString() }).eq("id", id);
      if (error) throw error;
    }

    // Pick a sending seat: the admin's own connected seat first, then any connected seat.
    const { data: seats } = await db.from("gmail_connections").select("owner,email");
    const connected = seats ?? [];
    if (connected.length === 0) throw new Error("No Google seat is connected yet — connect one under Settings → Google Workspace seats, then send the invite (or copy the invite link and send it yourself).");
    const seat = connected.find((row) => row.owner === me.owner) ?? connected[0];
    const owner = seat.owner as Owner;

    const base = (process.env.APP_URL ?? new URL(request.url).origin).trim().replace(/\s+/g, "");
    const inviteUrl = `${base.replace(/\/$/, "")}/invite/${token}`;
    const { subject, text } = buildInviteEmail({ name: user.name as string, appUrl: base, inviteUrl, senderName: me.name });

    const profile = await senderProfile(db, owner);
    await sendEmail(owner, fromHeader(profile, seat.email as string), user.email as string, subject, text);

    return Response.json({ ok: true, sentFrom: seat.email, to: user.email });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send the invite email" }, { status: 400 });
  }
}
