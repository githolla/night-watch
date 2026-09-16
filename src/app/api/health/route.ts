export const dynamic = "force-dynamic";

/** Config visibility for the *running* deployment — booleans and public URLs only, never a secret value.
 *  Lets an admin confirm from the browser whether the live build actually has the env it needs
 *  (e.g. after adding a variable and redeploying) instead of guessing from a failed login. */
export async function GET() {
  return Response.json({
    ok: true,
    // The key that encrypts sessions AND stored Gmail tokens. Login cannot work without it.
    tokenEncryptionKey: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
    // Whether a custom shared password is set. If false, the shared password is the built-in default.
    sharedPasswordSet: Boolean(process.env.SHARED_PASSWORD),
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY),
    google: {
      clientId: Boolean(process.env.GOOGLE_CLIENT_ID),
      clientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? null, // a public URL, not a secret
    },
    appUrl: process.env.APP_URL ?? null,
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
  });
}
