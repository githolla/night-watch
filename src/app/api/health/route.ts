import { schemaHealth } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";

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
  // Which silently-breaking columns are actually live in this database. A missing column here doesn't throw
  // — supabase-js returns { error } and most call sites ignore it — so without this the breakage is invisible.
  let schema: Awaited<ReturnType<typeof schemaHealth>> | { ok: null; missing: []; reason: string } = { ok: null, missing: [], reason: "Supabase is not configured" };
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) && (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) {
    try { schema = await schemaHealth(admin()); }
    catch (error) { schema = { ok: null, missing: [], reason: error instanceof Error ? error.message : "probe failed" }; }
  }
  return Response.json({
    ok: true,
    schema,
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
