import { versionMeta, versionLabel } from './version-attribution.ts';
import { firstOpenAt } from './open-tracking.ts';
export type TrackedTouch = {
  id: string; card_id: string; person_id: string; sent_by: string; sent_at: string | null; gmail_thread_id: string | null;
  reply_at: string | null; reply_classification: string | null;
  message_variants: { subject: string; dimensions: unknown; message_experiments: { context: string } | null } | null;
  people?: { full_name: string } | null;
};
export function aggregateVersions(touches: TrackedTouch[], options: { source?: 'gmail' | 'manual' | 'all'; since?: string } = {}) {
  const groups = new Map<string, TrackedTouch[]>();
  for (const touch of touches) {
    if (!touch.sent_at) continue;
    const key = `${touch.sent_by}:${touch.card_id}:${touch.person_id}`;
    groups.set(key, [...(groups.get(key) ?? []), touch]);
  }
  const rows = new Map<string, { label: string; sent: number; gmail: number; manual: number; opens: number; replies: number; positive: number; ooo: number }>();
  const recent: Array<{ id: string; personId: string; name: string; sentAt: string; label: string; subject: string; source: string; openAt: string | null; replied: boolean }> = [];
  let untracked = 0;
  for (const group of groups.values()) {
    group.sort((a,b) => a.sent_at!.localeCompare(b.sent_at!));
    const first = group.find(t => { const m = versionMeta(t.message_variants?.dimensions); return m && ['gmail','manual'].includes(m.source); });
    if (!first) { if (group.some(t => t.gmail_thread_id)) untracked++; continue; }
    const meta = versionMeta(first.message_variants!.dimensions)!;
    const source = meta.source === 'gmail' && first.gmail_thread_id ? 'gmail' : meta.source === 'manual' ? 'manual' : null;
    if (!source || (options.source && options.source !== 'all' && source !== options.source) || (options.since && first.sent_at! < options.since)) continue;
    const label = versionLabel(meta);
    const row = rows.get(label) ?? { label, sent: 0, gmail: 0, manual: 0, opens: 0, replies: 0, positive: 0, ooo: 0 };
    // Replies after a follow-up belong to the opening-version conversation, counted once.
    const eligible = group.filter(t => t.sent_at! >= first.sent_at!);
    const replied = eligible.some(t => Boolean(t.reply_at) && ['positive','neutral','objection','referral','negative'].includes(t.reply_classification ?? ''));
    const positive = eligible.some(t => Boolean(t.reply_at) && ['positive','referral'].includes(t.reply_classification ?? ''));
    const openAt = source === 'gmail' ? firstOpenAt(first.message_variants?.message_experiments?.context) : null;
    row.sent++; row[source]++; if (openAt) row.opens++; if (replied) row.replies++; if (positive) row.positive++;
    if (eligible.some(t => t.reply_at && t.reply_classification === 'ooo')) row.ooo++;
    rows.set(label, row);
    recent.push({ id: first.id, personId: first.person_id, name: first.people?.full_name ?? 'Contact', sentAt: first.sent_at!, label, subject: first.message_variants!.subject, source, openAt, replied });
  }
  return { rows: [...rows.values()].sort((a,b)=>b.sent-a.sent || a.label.localeCompare(b.label)), recent: recent.sort((a,b)=>b.sentAt.localeCompare(a.sentAt)).slice(0,25), untracked };
}
