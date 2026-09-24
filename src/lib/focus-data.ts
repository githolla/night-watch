import original from '../../data/revenue-focus.json' with { type: 'json' };
import batch from '../../data/batch-2-focus.json' with { type: 'json' };

export const originalFocus = original;
export const batchFocus = batch;
export const allFocus = [...original, ...batch];
/** The second stored seat retains its legacy database key; its user-facing name is Suuchi. */
export function focusForOwner(owner: string) {
  const assigned = owner === 'jenna' || owner === 'suuchi' ? 'suuchi' : owner === 'josh' ? 'josh' : null;
  return batch.filter(row => row.assignedOwner === assigned);
}
export function batchOwner(domain: string): 'josh' | 'jenna' | null {
  const row = batch.find(row => row.domain.toLowerCase() === domain.toLowerCase());
  return row ? row.assignedOwner === 'josh' ? 'josh' : 'jenna' : null;
}

/** List selection never changes the signed-in sender or the company's assigned owner. */
export function reachoutList(requested: string | undefined, viewer: 'josh' | 'jenna') {
  const id = requested === 'josh' || requested === 'suuchi'
    ? requested : viewer === 'josh' ? 'josh' : 'suuchi';
  const owner = id === 'josh' ? 'josh' : 'jenna';
  return { id, owner, href: `/outreach?list=${id}`, drafts: focusForOwner(owner) };
}
