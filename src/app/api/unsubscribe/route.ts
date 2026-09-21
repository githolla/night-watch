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

// Gmail's RFC 8058 one-click sends a POST — that's the ONLY thing that mutates.
export async function POST(request: Request) {
  const ok = await optOut(new URL(request.url).searchParams.get("t"));
  // Return 200 only when the flag was actually set. On a failed write, a 500 tells Gmail's one-click to
  // retry rather than mark them unsubscribed while we'd still contact them.
  return new Response(null, { status: ok ? 200 : 500 });
}

const page = (title: string, msg: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title><body style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1a1712;max-width:520px;margin:12vh auto;padding:0 24px"><h1 style="font-size:22px">${title}</h1>${msg}</body>`;

// A person clicking the link lands here. GET must NOT change anything — email clients, privacy proxies
// and link scanners all issue GET on links inside delivered mail, and a mutating GET would silently
// unsubscribe people who never clicked. So GET only shows a confirm button that POSTs the opt-out.
export async function GET(request: Request) {
  const t = new URL(request.url).searchParams.get("t");
  const body = t
    ? `<p>Click below to stop receiving outreach from Nine-67.</p><form method="POST" action="/api/unsubscribe?t=${encodeURIComponent(t)}"><button type="submit" style="font:600 15px/1 -apple-system,Arial,sans-serif;background:#1a1712;color:#fff;border:0;border-radius:8px;padding:12px 18px;cursor:pointer">Unsubscribe me</button></form>`
    : "<p>We couldn't read that unsubscribe link. Please reply to the email with “no” and we'll take care of it.</p>";
  return new Response(page("Unsubscribe", body), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
}
