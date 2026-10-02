import test from 'node:test';
import assert from 'node:assert/strict';
import { savedVariants, renderSavedVariant } from './outreach-variants.ts';
import { identifyVersion } from './version-attribution.ts';
import { aggregateVersions, fitBand, listOutcomeReport, suggestedMinFit, type ListedCard, type ListedCompany, type ListedTouch, type TrackedTouch } from './version-analytics.ts';

const domain = 'ansararestaurantgroup.com';
const variants = savedVariants(domain, 'Victor Ansara');
const touchFor = (variantId: string, id: string, sentBy: string, reply: string | null = null): TrackedTouch => {
  const draft = renderSavedVariant(variants.find(v => v.id === variantId)!, 'Victor Ansara', 'Josh Lee');
  const base = { domain, personId: `p-${id}`, contactName: 'Victor Ansara', senderName: 'Josh Lee', ...draft, source: 'gmail' as const };
  const selected = { ...draft, dimensions: identifyVersion({ ...base, source: 'selection' }) };
  return { id, card_id: `card-${id}`, person_id: `p-${id}`, sent_by: sentBy, sent_at: '2026-09-23T12:00:00Z', gmail_thread_id: `thread-${id}`, reply_at: reply ? '2026-09-24T12:00:00Z' : null, reply_classification: reply ?? 'none', message_variants: { subject: draft.subject, dimensions: identifyVersion(base, selected), message_experiments: { context: '' } } };
};
const touches = [
  touchFor('direct-offer', '1', 'josh', 'positive'), touchFor('direct-offer', '2', 'josh'), touchFor('direct-offer', '3', 'jenna', 'neutral'),
  touchFor('concrete-idea', '4', 'jenna'), touchFor('concrete-idea', '5', 'josh', 'referral'),
];
const sum = (rows: Array<{ label: string; sent: number; replies: number; positive: number }>) => {
  const out = new Map<string, { sent: number; replies: number; positive: number }>();
  for (const row of rows) { const entry = out.get(row.label) ?? { sent: 0, replies: 0, positive: 0 }; entry.sent += row.sent; entry.replies += row.replies; entry.positive += row.positive; out.set(row.label, entry); }
  return Object.fromEntries([...out].sort(([a], [b]) => a.localeCompare(b)));
};

test('grouping by sender splits each version and leaves per-version totals unchanged', () => {
  const plain = aggregateVersions(touches);
  const bySender = aggregateVersions(touches, { groupBy: 'sender' });
  assert.ok(plain.rows.every(row => !('group' in row)), 'ungrouped rows keep their old shape');
  assert.deepEqual(sum(bySender.rows), sum(plain.rows));
  const direct = bySender.rows.filter(row => row.label === 'Direct Offer');
  assert.deepEqual(direct.map(row => [row.group, row.sent, row.replies, row.positive]).sort(), [['jenna', 1, 1, 0], ['josh', 2, 1, 1]]);
});

test('grouping by fit band covers every send exactly once', () => {
  const fit = new Map([['card-1', 40], ['card-2', 60], ['card-3', 75], ['card-4', 90]]);
  const byFit = aggregateVersions(touches, { groupBy: 'fit', fitScoreByCard: fit });
  assert.equal(byFit.rows.reduce((total, row) => total + row.sent, 0), touches.length);
  assert.deepEqual(sum(byFit.rows), sum(aggregateVersions(touches).rows));
  assert.deepEqual(new Set(byFit.rows.map(row => row.group)), new Set(['below 55', '55-69', '70+', 'no fit score']));
  assert.equal(fitBand(54), 'below 55'); assert.equal(fitBand(55), '55-69'); assert.equal(fitBand(70), '70+'); assert.equal(fitBand(null), 'no fit score');
});

const companies: ListedCompany[] = [
  { domain: 'a.test', sector_key: 0, fit_score: 45, fit: { breakdown: { hiring: 10 } } },
  { domain: 'b.test', sector_key: 0, fit_score: 62, fit: null },
  { domain: 'c.test', sector_key: 3, fit_score: 80, fit: null },
  { domain: 'd.test', sector_key: 3, fit_score: 85, fit: null },
  { domain: 'e.test', sector_key: null, fit_score: null, fit: null },
];
const cards: ListedCard[] = [
  { id: 'a', domain: 'a.test', status: 'dismissed' },
  { id: 'b', domain: 'b.test', status: 'replied' },
  { id: 'c', domain: 'c.test', status: 'meeting', meeting_at: '2026-09-20T00:00:00Z' },
  { id: 'd', domain: 'd.test', status: 'sent' },
  { id: 'e', domain: 'e.test', status: 'sent' },
  { id: 'x', domain: 'not-listed.test', status: 'sent' },
];
const sent = (card_id: string, sent_at: string, reply: string | null = null, channel = 'email'): ListedTouch => ({ card_id, channel, sent_at, reply_classification: reply });
const listTouches = [
  sent('a', '2026-09-01T12:00:00Z', 'negative'), sent('a', '2026-09-04T12:00:00Z'),
  sent('b', '2026-09-02T12:00:00Z', 'neutral'),
  sent('c', '2026-09-03T12:00:00Z', 'positive'),
  sent('d', '2026-08-01T12:00:00Z'),
  sent('e', '2026-09-05T12:00:00Z'),
  sent('x', '2026-09-05T12:00:00Z', 'positive'),
];

test('list outcomes: fit-band rows sum to the total sends, one send per card, by sector with the learned weight', () => {
  const report = listOutcomeReport(companies, cards, listTouches, { sectorLabels: ['trades', 'pest', 'landscape', 'wholesale'] });
  assert.equal(report.total.sends, 5, 'follow-ups add nothing and unlisted companies are left out');
  assert.equal(report.bands.reduce((total, band) => total + band.sends, 0), report.total.sends);
  assert.deepEqual(report.bands.map(band => [band.label, band.sends, band.replies, band.positive, band.meetings]), [['below 55', 1, 1, 0, 0], ['55-69', 1, 1, 0, 0], ['70+', 2, 1, 1, 1], ['no fit score', 1, 0, 0, 0]]);
  assert.ok(report.bands.every(band => band.tooSmall), 'fewer than 10 replies is too small to read');
  const wholesale = report.sectors.find(sector => sector.label === 'wholesale')!;
  assert.deepEqual([wholesale.sends, wholesale.positive, wholesale.meetings], [2, 1, 1]);
  assert.equal(wholesale.weight, null, 'no learned weight before 5 positives overall');
  assert.ok(report.sectors.some(sector => sector.label === 'Unknown sector'));
});

test('list outcomes respect the days filter by first send', () => {
  const report = listOutcomeReport(companies, cards, listTouches, { since: '2026-09-02T00:00:00Z', sectorLabels: [] });
  assert.equal(report.total.sends, 3, 'cards first emailed before the window are left out, even with a later follow-up');
});

test('the suggested minimum fit is display-only and waits for enough replies', () => {
  const line = (label: string, sends: number, replies: number, positive: number) => ({ label, sends, replies, positive, meetings: 0, tooSmall: replies < 10 });
  assert.equal(suggestedMinFit({ total: line('all', 5, 3, 1), bands: [] }, 40), null);
  const report = { total: line('all', 300, 60, 15), bands: [line('below 55', 100, 20, 2), line('55-69', 100, 20, 6), line('70+', 100, 20, 7)] };
  assert.equal(suggestedMinFit(report, 40), 55);
  assert.equal(suggestedMinFit({ ...report, bands: [line('below 55', 100, 20, 6), ...report.bands.slice(1)] }, 40), 40);
});
