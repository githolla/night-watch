import { admin } from '@/lib/supabase/admin';
import { openTrackingId } from '@/lib/open-tracking';
import { SAVED_VERSION_MODEL, versionMeta } from '@/lib/version-attribution';
export const dynamic = 'force-dynamic';
const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
export async function GET(request: Request) {
  const id = openTrackingId(new URL(request.url).searchParams.get('t') ?? '');
  if (id && request.method === "GET") try {
    const db = admin();
    const { data } = await db.from('message_variants').select('experiment_id,dimensions').eq('id', id).maybeSingle();
    const meta = versionMeta(data?.dimensions);
    if (data && meta && ['gmail', 'followup'].includes(meta.source)) {
      // Atomic first detection only. Reloads/proxies cannot inflate an open count.
      // No IP addresses, user-agent fingerprint or location is collected.
      await db.from('message_experiments').update({ context: JSON.stringify({ firstOpenAt: new Date().toISOString() }) }).eq('id', data.experiment_id).eq('model', SAVED_VERSION_MODEL).eq('context', '');
    }
  } catch { /* A broken tracking service must never break the recipient's email. */ }
  return new Response(pixel, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'private, no-store, no-cache, max-age=0, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
}
