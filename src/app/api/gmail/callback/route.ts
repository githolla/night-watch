import { timingSafeEqual } from "node:crypto";
import { exchangeCode, googleProfile, OAUTH_STATE_COOKIE } from "@/lib/gmail";
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
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    // state is `owner.nonce`; the nonce must match the cookie set when the handshake began (CSRF guard).
    const [ownerPart, ...nonceParts] = (url.searchParams.get("state") ?? "").split(".");
    const owner = z.enum(["josh", "jenna"]).parse(ownerPart);
    const cookieNonce = readCookie(request.headers.get("cookie"), OAUTH_STATE_COOKIE);
    if (!nonceMatches(nonceParts.join("."), cookieNonce)) throw new Error("OAuth state check failed — please start the connection again from Settings.");
    if (!code) throw new Error("Missing OAuth code");
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token — remove the app under Google Account access and reconnect.");
    const profile = await googleProfile(tokens.access_token);
    const email = profile.email ?? `${owner}@nine-67.com`;
    const scopes = tokens.scope ?? "";
    const db = admin();
    await db.from("gmail_connections").upsert({
      owner,
      email,
      scopes,
      calendar: /\/auth\/calendar/.test(scopes),
      connected_at: new Date().toISOString(),
      refresh_token_ciphertext: encrypt(tokens.refresh_token),
    }, { onConflict: "owner" });

    // Pre-fill the signature name from the connected Google account — but never overwrite one already set.
    if (profile.name?.trim()) {
      const { data: existing } = await db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle();
      if (!existing) await db.from("sender_profiles").insert({ owner, from_name: profile.name.trim() });
      else if (!(existing.from_name as string | null)?.trim()) await db.from("sender_profiles").update({ from_name: profile.name.trim() }).eq("owner", owner);
    }
    // Clear the one-time state cookie now that the handshake is complete.
    return new Response(null, { status: 302, headers: new Headers({
      Location: `${process.env.APP_URL ?? url.origin}/settings?gmail=connected`,
      "Set-Cookie": `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
    }) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "OAuth failed" }, { status: 400 });
  }
}
