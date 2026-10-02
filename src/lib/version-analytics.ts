import { firstGiftViewAt } from "./gift-tracking.ts";
import { versionMeta, versionLabel } from './version-attribution.ts';
import { firstOpenAt } from './open-tracking.ts';
import { FIT_BANDS, fitOutcomes, listOutcomes, sectorWeights, type AiFitCriterion, type OutcomeTouch } from './ai-fit.ts';
export type TrackedTouch = {
  id: string; card_id: string; person_id: string; sent_by: string; sent_at: string | null; gmail_thread_id: string | null;
  reply_at: string | null; reply_classification: string | null;
  message_variants: { subject: string; dimensions: unknown; message_experiments: { context: string } | null } | null;
  people?: { full_name: string } | null;
};
/** Split each version's row by who sent it, or by the AI-fit band of the company's nightly list row. */
export type VersionGrouping = 'sender' | 'fit';
export type FitBand = (typeof FIT_BANDS)[number] | 'no fit score';
export const fitBand = (score: number | null | undefined): FitBand => score == null || !Number.isFinite(score) ? 'no fit score' : score < 55 ? FIT_BANDS[0] : score < 70 ? FIT_BANDS[1] : FIT_BANDS[2];
export function aggregateVersions(touches: TrackedTouch[], options: { source?: 'gmail' | 'manual' | 'all'; since?: string; groupBy?: VersionGrouping; fitScoreByCard?: ReadonlyMap<string, number> } = {}) {
  const groups = new Map<string, TrackedTouch[]>();
  for (const touch of touches) {
    if (!touch.sent_at) continue;
    const key = `${versionMeta(touch.message_variants?.dimensions)?.channel ?? "email"}:${touch.sent_by}:${touch.card_id}:${touch.person_id}`;
    groups.set(key, [...(groups.get(key) ?? []), touch]);
  }
  const rows = new Map<string, { label: string; group?: string; sent: number; gmail: number; manual: number; opens: number; giftViews: number; replies: number; positive: number; ooo: number }>();
  const recent: Array<{ id: string; personId: string; name: string; sentAt: string; label: string; subject: string; source: string; openAt: string | null; giftViewAt: string | null; replied: boolean }> = [];
  let untracked = 0;
  for (const group of groups.values()) {
    group.sort((a,b) => a.sent_at!.localeCompare(b.sent_at!));
    const first = group.find(t => { const m = versionMeta(t.message_variants?.dimensions); return m && ['gmail','manual'].includes(m.source); });
    if (!first) { if (group.some(t => t.gmail_thread_id)) untracked++; continue; }
    const meta = versionMeta(first.message_variants!.dimensions)!;
    const source = meta.source === 'gmail' && first.gmail_thread_id ? 'gmail' : meta.source === 'manual' ? 'manual' : null;
    if (!source || (options.source && options.source !== 'all' && source !== options.source) || (options.since && first.sent_at! < options.since)) continue;
    const label = versionLabel(meta);
    const split = options.groupBy === 'sender' ? first.sent_by : options.groupBy === 'fit' ? fitBand(options.fitScoreByCard?.get(first.card_id)) : undefined;
    const rowKey = split === undefined ? label : `${label}\u0000${split}`;
    const row = rows.get(rowKey) ?? { label, ...(split === undefined ? {} : { group: split }), sent: 0, gmail: 0, manual: 0, opens: 0, giftViews: 0, replies: 0, positive: 0, ooo: 0 };
    // Replies after a follow-up belong to the opening-version conversation, counted once.
    const eligible = group.filter(t => t.sent_at! >= first.sent_at!);
    const replied = eligible.some(t => Boolean(t.reply_at) && ['positive','neutral','objection','referral','negative'].includes(t.reply_classification ?? ''));
    const positive = eligible.some(t => Boolean(t.reply_at) && ['positive','referral'].includes(t.reply_classification ?? ''));
    const openAt = source === 'gmail' ? firstOpenAt(first.message_variants?.message_experiments?.context) : null;
    const giftViewAt = source === 'gmail' ? firstGiftViewAt(first.message_variants?.message_experiments?.context) : null;
    if(giftViewAt) row.giftViews++;
    row.sent++; row[source]++; if (openAt) row.opens++; if (replied) row.replies++; if (positive) row.positive++;
    if (eligible.some(t => t.reply_at && t.reply_classification === 'ooo')) row.ooo++;
    rows.set(rowKey, row);
    recent.push({ id: first.id, personId: first.person_id, name: first.people?.full_name ?? 'Contact', sentAt: first.sent_at!, label, subject: first.message_variants!.subject, source, openAt, giftViewAt, replied });
  }
  return { rows: [...rows.values()].sort((a,b)=>b.sent-a.sent || a.label.localeCompare(b.label) || (a.group ?? '').localeCompare(b.group ?? '')), recent: recent.sort((a,b)=>b.sentAt.localeCompare(a.sentAt)).slice(0,25), untracked };
}

/** A company that went on a nightly list (list_candidates with status 'listed'). */
export type ListedCompany = { domain: string; sector_key: number | null; fit_score: number | null; fit: { breakdown?: Partial<Record<AiFitCriterion, number>> } | null };
export type ListedCard = { id: string; domain: string; status: string | null; meeting_at?: string | null; qualified_at?: string | null; opportunity_at?: string | null };
export type ListedTouch = { card_id: string; channel: string; sent_at: string | null; reply_classification: string | null };
export type OutcomeLine = { label: string; sends: number; replies: number; positive: number; meetings: number; tooSmall: boolean };
const MIN_REPLIES_TO_READ = 10;

/**
 * Sends, replies, positive replies and meetings for listed companies, by fit band and by sector, counted with
 * listOutcomes (one send per card, from touches). `since` keeps cards whose first email went out on or after
 * it. The learned sector weight is computed over all time, the way the nightly build would learn it.
 */
export function listOutcomeReport(companies: ListedCompany[], cards: ListedCard[], touches: ListedTouch[], options: { since?: string; sectorLabels: readonly string[] }) {
  const company = new Map(companies.map(row => [row.domain.toLowerCase(), row]));
  const cardById = new Map(cards.map(card => [card.id, card]));
  const rows: OutcomeTouch[] = [];
  for (const touch of touches) {
    const card = cardById.get(touch.card_id);
    const listed = card ? company.get(card.domain.toLowerCase()) : undefined;
    if (!card || !listed) continue;
    rows.push({ cardId: card.id, sector: listed.sector_key == null ? null : String(listed.sector_key), channel: touch.channel, sentAt: touch.sent_at, replyClassification: touch.reply_classification, cardStatus: card.status, meetingAt: card.meeting_at ?? null, qualifiedAt: card.qualified_at ?? null, opportunityAt: card.opportunity_at ?? null, fitScore: listed.fit_score, breakdown: listed.fit?.breakdown ?? null });
  }
  const weights = sectorWeights(listOutcomes(rows).bySector);
  const firstSend = new Map<string, string>();
  for (const row of rows) if (row.channel === 'email' && row.sentAt && (!firstSend.has(row.cardId) || row.sentAt < firstSend.get(row.cardId)!)) firstSend.set(row.cardId, row.sentAt);
  const inWindow = options.since ? rows.filter(row => (firstSend.get(row.cardId) ?? '') >= options.since!) : rows;
  const outcomes = listOutcomes(inWindow).cards;
  const met = (cardId: string) => { const card = cardById.get(cardId); return Boolean(card?.meeting_at) || card?.status === 'meeting'; };
  const line = (label: string, members: typeof outcomes): OutcomeLine => {
    const replies = members.filter(card => card.replied).length;
    return { label, sends: members.length, replies, positive: members.filter(card => card.positive).length, meetings: members.filter(card => met(card.cardId)).length, tooSmall: replies < MIN_REPLIES_TO_READ };
  };
  const scored = fitOutcomes(outcomes.map(card => ({ fitScore: card.fitScore, breakdown: card.breakdown, positive: card.positive, replied: card.replied })));
  const bands: OutcomeLine[] = scored.bands.map(band => ({ label: band.band, sends: band.sends, replies: band.replies, positive: band.positive, meetings: outcomes.filter(card => fitBand(card.fitScore) === band.band && met(card.cardId)).length, tooSmall: band.tooSmall }));
  const unscored = outcomes.filter(card => fitBand(card.fitScore) === 'no fit score');
  if (unscored.length) bands.push(line('no fit score', unscored));
  const sectorKeys = [...new Set([...outcomes.map(card => card.sector ?? ''), ...Object.keys(weights)])];
  const sectors = sectorKeys.map(key => ({ ...line(key === '' ? 'Unknown sector' : options.sectorLabels[Number(key)] ?? `Sector ${key}`, outcomes.filter(card => (card.sector ?? '') === key)), weight: key === '' ? null : weights[key] ?? null }))
    .sort((a, b) => b.sends - a.sends || a.label.localeCompare(b.label));
  return { total: line('All listed companies', outcomes), bands, sectors };
}

/**
 * A suggested NIGHTLY_LIST_MIN_FIT, for display only: the lower edge of the lowest fit band, with enough
 * replies to read, whose positive-reply rate is at least the overall rate. Null until the data can say.
 * The lowest band has no lower edge here, so it suggests keeping the current setting.
 */
export function suggestedMinFit(report: { total: OutcomeLine; bands: OutcomeLine[] }, current: number): number | null {
  if (!report.total.sends || report.total.tooSmall) return null;
  const overall = report.total.positive / report.total.sends;
  const edges: Record<string, number> = { [FIT_BANDS[0]]: current, [FIT_BANDS[1]]: 55, [FIT_BANDS[2]]: 70 };
  const lowest = report.bands.find(band => band.label in edges && !band.tooSmall && band.sends && band.positive / band.sends >= overall);
  return lowest ? edges[lowest.label] : null;
}
