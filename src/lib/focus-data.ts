import original from '../../data/revenue-focus.json' with { type: 'json' };
import batch from '../../data/batch-2-focus.json' with { type: 'json' };
import nextBatch from '../../data/batch-3-focus.json' with { type: 'json' };

export const originalFocus = original;
export const batchFocus = batch;
export const nextBatchFocus = nextBatch;
export const allFocus = [...original, ...batch, ...nextBatch];
/** The second stored seat retains its legacy database key; its user-facing name is Suuchi. */
export function focusForOwner(owner: string, sequence: 1 | 2 = 1) {
  const assigned = owner === 'jenna' || owner === 'suuchi' ? 'suuchi' : owner === 'josh' ? 'josh' : null;
  return (sequence === 2 ? nextBatch : batch).filter(row => row.assignedOwner === assigned);
}
export function batchOwner(domain: string): 'josh' | 'jenna' | null {
  const row = [...batch, ...nextBatch].find(row => row.domain.toLowerCase() === domain.toLowerCase());
  return row ? row.assignedOwner === 'josh' ? 'josh' : 'jenna' : null;
}

/** The selected list determines draft identity; sending still requires its owner to sign in. */
export function reachoutList(requested: string | undefined, viewer: 'josh' | 'jenna', sequence: 1 | 2 = 1) {
  const id = requested === 'josh' || requested === 'suuchi'
    ? requested : viewer === 'josh' ? 'josh' : 'suuchi';
  const owner: 'josh' | 'jenna' = id === 'josh' ? 'josh' : 'jenna';
  return { id, owner, sequence, href: `/outreach?list=${id}&batch=${sequence}`, drafts: focusForOwner(owner, sequence) };
}

/** A shared list is viewable by teammates, but its drafts belong to its assigned sender. */
export function assertListSender(domain: string | null | undefined, viewer: 'josh' | 'jenna') {
 const owner = domain ? batchOwner(domain) : null;
 if (owner && owner !== viewer) throw new Error(`Sign in as ${owner === 'josh' ? 'Josh' : 'Suuchi'} to send prospect emails from this list.`);
}
