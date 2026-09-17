import { exchangeCode, googleProfile } from "@/lib/gmail";
import { encrypt } from "@/lib/crypto";
import { admin } from "@/lib/supabase/admin";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const owner = z.enum(["josh", "jenna"]).parse(url.searchParams.get("state"));
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
    return Response.redirect(`${process.env.APP_URL ?? url.origin}/settings?gmail=connected`);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "OAuth failed" }, { status: 400 });
  }
}
