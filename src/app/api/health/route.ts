export const dynamic = "force-dynamic";

/** Whitespace-revealing diagnostics for one env var. `raw` shows leading/trailing
 *  whitespace as visible markers so a stray tab/space pasted into Vercel is obvious. */
function inspect(value: string | undefined) {
  if (value == null) return { present: false };
  const trimmed = value.trim();
  return {
    present: true,
    length: value.length,
    dirty: value !== trimmed, // true = has leading/trailing whitespace (a paste error)
    raw: value.replace(/\t/g, "⇥").replace(/^ +| +$/g, (m) => "·".repeat(m.length)),
  };
}
/** Client IDs and redirect URIs are not secrets — they travel in the OAuth URL — so we can show
 *  them to catch paste errors. The client secret is masked to its length + whitespace only. */
function secretInspect(value: string | undefined) {
  if (value == null) return { present: false };
  return { present: true, length: value.length, dirty: value !== value.trim() };
}

export async function GET() {
  return Response.json({
    ok: true,
    tokenEncryptionKey: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
    sharedPasswordSet: Boolean(process.env.SHARED_PASSWORD),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY),
    google: {
      clientId: inspect(process.env.GOOGLE_CLIENT_ID),
      clientSecret: secretInspect(process.env.GOOGLE_CLIENT_SECRET),
      redirectUri: inspect(process.env.GOOGLE_REDIRECT_URI),
    },
    appUrl: inspect(process.env.APP_URL),
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  });
}
