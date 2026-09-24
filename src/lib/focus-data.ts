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

/** The selected list determines draft identity; sending still requires its owner to sign in. */
export function reachoutList(requested: string | undefined, viewer: 'josh' | 'jenna') {
  const id = requested === 'josh' || requested === 'suuchi'
    ? requested : viewer === 'josh' ? 'josh' : 'suuchi';
  const owner: 'josh' | 'jenna' = id === 'josh' ? 'josh' : 'jenna';
  return { id, owner, href: `/outreach?list=${id}`, drafts: focusForOwner(owner) };
}

/** A shared list is viewable by teammates, but its drafts belong to its assigned sender. */
export function assertListSender(domain: string | null | undefined, viewer: 'josh' | 'jenna') {
 const owner = domain ? batchOwner(domain) : null;
 if (owner && owner !== viewer) throw new Error(`Sign in as ${owner === 'josh' ? 'Josh' : 'Suuchi'} to send prospect emails from this list.`);
}
