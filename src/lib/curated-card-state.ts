import { isCuratedDomain } from './curated-worklist.ts';

export function isSelectedDraft(domain: string | null | undefined, hash: string | null | undefined) {
  return isCuratedDomain(domain) && hash === `operator-shortlist-20260923:${domain}`;
}

/** Only recover cards retired by the automated research rules, never user dismissals. */
export function wasAutomaticallyArchived(card: { status: string; dismiss_reason?: string | null; score_breakdown?: unknown }) {
  if (card.status !== 'archived') return false;
  const reason = card.dismiss_reason;
  if (reason) return reason === 'Not on the reach-out list. Promote the company on its page if it belongs there.'
    || reason === 'Created before the operating-need rule; the source was commentary, not work Nine-67 could do.'
    || /^Source is older than \d+ days/.test(reason);
  // Selected drafts were created with no scoring inputs. The decay job archived them without a reason.
  const breakdown = card.score_breakdown as Record<string, unknown> | null;
  return Boolean(breakdown && Object.entries(breakdown).every(([key, value]) => key === 'recency' || (['signal_strength', 'person_fit', 'relationship_path'].includes(key) && value === 0)));
}
