import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { oauthStateCookie, oauthUrl, OAUTH_STATE_COOKIE } from "@/lib/gmail";
import { z } from "zod";

const owner = z.enum(["josh", "suuchi"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const user = await requireUser();
    if (user.actor) return Response.json({ error: "Exit admin mode to manage mailbox connections. Suuchi should connect her own Google account." }, { status: 403 });
    // Don't hand Google a half-built URL (empty client_id) — that returns Google's own 400 page. Bounce back with a clear reason.
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REDIRECT_URI) {
      return Response.redirect(`${process.env.APP_URL ?? url.origin}/settings?connect=unconfigured`);
    }
    // Seat scoping: a member may only (re)connect their OWN seat; only an admin may connect either seat.
    // The callback trusts the seat carried in `state`, so this is the choke point that stops a member from
    // binding (or overwriting) the other seat's mailbox and sending identity.
    const parsed = owner.safeParse(url.searchParams.get("owner") ?? user.owner);
    if (!parsed.success) return Response.json({error:"Unknown sending account."},{status:400});
    const requested = parsed.data;
    if (user.role !== "admin" && requested !== user.owner) return Response.json({error:"You can only connect your own sending account."},{status:403});
    const seat = requested;
    // Mint a one-time nonce and carry it in the OAuth `state`. The cookie is an encrypted record of the nonce,
    // the seat and the user who began, so the callback can refuse a `state` whose seat was edited (a member
    // swapping "suuchi." for "josh." to bind their own Google account to the admin's seat) and a callback
    // finished by anyone other than the person who started it. SameSite=Lax rides the redirect back.
    const nonce = randomBytes(24).toString("base64url");
    // Secure only in production: on plain-HTTP local dev the browser would drop a Secure cookie and every
    // callback would then fail the state check. Matches the login cookie's convention.
    const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
    const headers = new Headers({ Location: oauthUrl(seat, nonce) });
    headers.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=${oauthStateCookie({ nonce, owner: seat, uid: user.id })}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=600`);
    return new Response(null, { status: 302, headers });
  } catch {
    return Response.redirect(`${process.env.APP_URL ?? url.origin}/login`);
  }
}
