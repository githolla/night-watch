import { timingSafeEqual } from "node:crypto";
import { exchangeCode, googleProfile, OAUTH_STATE_COOKIE, readOAuthStateCookie } from "@/lib/gmail";
import { requireActualUser } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

// The value of one cookie from a raw Cookie header, or "" if absent.
function readCookie(header: string | null, name: string) {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

const nonceMatches = (a: string, b: string) => {
  if (!a || !b) return false;
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

export async function GET(request: Request) {
  const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    // state is `owner.nonce`. The sealed cookie records the nonce, the seat and the user who began; all three
    // must agree, and the person finishing must be that user and still allowed to connect that seat. The
    // seat in `state` is never trusted on its own: it arrives in a URL anyone can edit.
    const [ownerPart, ...nonceParts] = (url.searchParams.get("state") ?? "").split(".");
    const owner = z.enum(["josh", "suuchi"]).parse(ownerPart);
    const handshake = readOAuthStateCookie(readCookie(request.headers.get("cookie"), OAUTH_STATE_COOKIE));
    if (!handshake || !nonceMatches(nonceParts.join("."), handshake.nonce) || handshake.owner !== owner) throw new Error("OAuth state check failed. Start the connection again from Settings.");
    const user = await requireActualUser().catch(() => null);
    if (!user || user.id !== handshake.uid) throw new Error("Sign in as the person who started this connection, then try again from Settings.");
    if (user.role !== "admin" && user.owner !== owner) throw new Error("You can only connect your own sending account.");
    if (!code) throw new Error("Missing OAuth code");
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token — remove the app under Google Account access and reconnect.");
    const profile = await googleProfile(tokens.access_token);
    // Never guess the sending address: a wrong From is rejected or rewritten by Gmail on every send.
    if (!profile.email) throw new Error("Google did not share the account's email address. Reconnect and allow email access.");
    const email = profile.email;
    const scopes = tokens.scope ?? "";
    const db = admin();
    // connected_at drives the warm-up ramp, so it must be the FIRST connection, not the latest. Stamping it
    // on every OAuth round-trip meant re-granting a scope or fixing a token silently dropped a fully warmed
    // mailbox back to the starting cap, with nothing in the UI to explain the sudden drop.
    const { data: already } = await db.from("gmail_connections").select("connected_at").eq("owner", owner).maybeSingle();
    await db.from("gmail_connections").upsert({
      owner,
      email,
      scopes,
      calendar: /\/auth\/calendar/.test(scopes),
      connected_at: (already?.connected_at as string | null) ?? new Date().toISOString(),
      refresh_token_ciphertext: encrypt(tokens.refresh_token),
    }, { onConflict: "owner" });

    // Pre-fill the signature name from the connected Google account — but never overwrite one already set.
    if (profile.name?.trim()) {
      const { data: existing } = await db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle();
      if (!existing) await db.from("sender_profiles").insert({ owner, from_name: profile.name.trim() });
      else if (!(existing.from_name as string | null)?.trim()) await db.from("sender_profiles").update({ from_name: profile.name.trim() }).eq("owner", owner);
    }
    // Clear the one-time state cookie now that the handshake is complete.
    const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
    return new Response(null, { status: 302, headers: new Headers({
      Location: `${base}/settings?gmail=connected`,
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=0`,
    }) });
  } catch (error) {
    // Redirect back to Settings with a readable message instead of dumping raw JSON on the user after a
    // top-level OAuth navigation (state mismatch, missing refresh token, etc.).
    const reason = error instanceof Error ? error.message : "OAuth failed";
    return Response.redirect(`${base}/settings?gmail=error&reason=${encodeURIComponent(reason)}`);
  }
}
