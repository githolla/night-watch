import { focusForOwner, type ListSequence } from './focus-data.ts';

export type BatchCard = { domain: string; owner: string | null; status: string; contacted?: boolean };
const contacted = new Set(['sent', 'replied', 'positive', 'meeting', 'negative']);

/** Every list stays reachable; completion and a waiting nightly list only choose the default landing list. */
export function selectedBatch(requested: string | undefined, defaultSequence: ListSequence): ListSequence {
  return requested === '1' ? 1 : requested === '2' ? 2 : requested === 'today' ? 3 : defaultSequence;
}

/** Missing, snoozed, edited, approved and automatically archived work do not advance the default batch. */
export function batchProgress(owner: 'josh' | 'jenna', cards: BatchCard[], completedOnLoad: string[] = []) {
  const current = focusForOwner(owner);
  const completedDomains = current.filter(company => {
    if (completedOnLoad.includes(company.domain)) return true;
    const matching = cards.filter(card => card.owner === owner && card.domain === company.domain);
    return matching.some(card => card.contacted || contacted.has(card.status))
      || (matching.length > 0 && matching.every(card => card.status === 'dismissed'));
  }).map(company => company.domain);
  const completed = completedDomains.length;
  return { completed, completedDomains, total: current.length, sequence: (current.length > 0 && completed === current.length ? 2 : 1) as 1 | 2 };
}
