import { encrypt, decrypt } from './crypto.ts';
const PURPOSE = 'night-watch-email-open:';
export function trackedEmailHtml(html: string, baseUrl: string, versionId: string) {
  const url = new URL('/api/email-open', baseUrl);
  url.searchParams.set('t', encrypt(`${PURPOSE}${versionId}`));
  return `${html}<img src="${url.toString().replace(/&/g, '&amp;')}" width="1" height="1" alt="" style="border:0;width:1px;height:1px" />`;
}
export function openTrackingId(token: string): string | null {
  if (!token || token.length > 512) return null;
  try {
    const value = decrypt(token);
    if (!value.startsWith(PURPOSE)) return null;
    const id = value.slice(PURPOSE.length);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
  } catch { return null; }
}
export function firstOpenAt(context: unknown): string | null {
  if (typeof context !== 'string') return null;
  try { const value = JSON.parse(context); return typeof value.firstOpenAt === 'string' && Number.isFinite(Date.parse(value.firstOpenAt)) ? value.firstOpenAt : null; } catch { return null; }
}
