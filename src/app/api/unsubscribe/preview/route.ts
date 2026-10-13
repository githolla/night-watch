const page = (title: string, content: string) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe preview</title><body style="font:16px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#1a1712;max-width:520px;margin:12vh auto;padding:0 24px"><h1 style="font-size:22px">${title}</h1>${content}</body>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
export async function GET() {
  return page("Unsubscribe preview", '<p>This is a test email. This preview cannot unsubscribe a prospect.</p><form method="POST" action="/api/unsubscribe/preview"><button type="submit" style="font:600 15px/1 -apple-system,Arial,sans-serif;background:#1a1712;color:#fff;border:0;border-radius:8px;padding:12px 18px;cursor:pointer">Unsubscribe me</button></form>');
}
export async function POST() {
  return page("Preview complete", "<p>This is a test. Nobody was unsubscribed and no follow-ups were changed.</p>");
}
