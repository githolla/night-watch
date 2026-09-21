import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { oauthUrl, OAUTH_STATE_COOKIE } from "@/lib/gmail";
import { z } from "zod";

const owner = z.enum(["josh", "jenna"]).catch("josh");

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    await requireUser();
    // Don't hand Google a half-built URL (empty client_id) — that returns Google's own 400 page. Bounce back with a clear reason.
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      return Response.redirect(`${process.env.APP_URL ?? url.origin}/settings?connect=unconfigured`);
    }
    // Mint a one-time nonce, drop it in an httpOnly cookie, and carry it in the OAuth `state`. The callback
    // only proceeds when the two match, so a forged callback (attacker's code + a chosen seat) can't bind a
    // mailbox to a seat the user never authorized. SameSite=Lax still rides the top-level redirect back.
    const nonce = randomBytes(24).toString("base64url");
    const headers = new Headers({ Location: oauthUrl(owner.parse(url.searchParams.get("owner")), nonce) });
    headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`);
    return new Response(null, { status: 302, headers });
  } catch {
    return Response.redirect(`${process.env.APP_URL ?? url.origin}/login`);
  }
}
