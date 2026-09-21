import { decrypt } from "@/lib/crypto";
import { admin } from "@/lib/supabase/admin";

// One-click unsubscribe (RFC 8058) + a click-through page. The token is the encrypted person id, so no
// login is needed; acting on it flips the person's do_not_contact flag, which every send path already
// honors (manual send, cadence steps, worklists).
async function optOut(token: string | null): Promise<boolean> {
  if (!token) return false;
  let personId: string;
  try { personId = decrypt(token); } catch { return false; }
  if (!personId) return false;
  const { error } = await admin().from("people").update({ do_not_contact: true }).eq("id", personId);
  return !error;
}

// Gmail's one-click sends a POST — acknowledge fast with 200 whether or not it resolves.
export async function POST(request: Request) {
  await optOut(new URL(request.url).searchParams.get("t"));
  return new Response(null, { status: 200 });
}

// A person clicking the link in the footer lands here.
export async function GET(request: Request) {
  const ok = await optOut(new URL(request.url).searchParams.get("t"));
  const body = ok
    ? "<h1>You're unsubscribed.</h1><p>You won't receive any more outreach from Nine-67. Thanks for letting us know.</p>"
    : "<h1>Link expired</h1><p>We couldn't process that unsubscribe link. Please reply to the email with “no” and we'll take care of it.</p>";
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1a1712;max-width:520px;margin:12vh auto;padding:0 24px">${body}</body>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
