import { researchData } from '#research-data';
import { derived } from './research-data/derived.ts';

// Functions, not constants: in the browser the rows arrive with the page (see research-data/server.ts).
export const originalFocus = () => researchData().revenueFocus;
export const batchFocus = () => researchData().batch2Focus;
export const nextBatchFocus = () => researchData().batch3Focus;
export const allFocus = derived(() => [...originalFocus(), ...batchFocus(), ...nextBatchFocus()]);
/** The second stored seat retains its legacy database key; its user-facing name is Suuchi. */
export function focusForOwner(owner: string, sequence: 1 | 2 = 1) {
  const assigned = owner === 'jenna' || owner === 'suuchi' ? 'suuchi' : owner === 'josh' ? 'josh' : null;
  return (sequence === 2 ? nextBatchFocus() : batchFocus()).filter(row => row.assignedOwner === assigned);
}
export function batchOwner(domain: string): 'josh' | 'jenna' | null {
  const row = [...batchFocus(), ...nextBatchFocus()].find(row => row.domain.toLowerCase() === domain.toLowerCase());
  return row ? row.assignedOwner === 'josh' ? 'josh' : 'jenna' : null;
}

/** The selected list determines draft identity; sending still requires its owner to sign in. */
export function reachoutList(requested: string | undefined, viewer: 'josh' | 'jenna', sequence: 1 | 2 = 1) {
  const id: 'josh' | 'suuchi' = requested === 'josh' || requested === 'suuchi'
    ? requested : viewer === 'josh' ? 'josh' : 'suuchi';
  const owner: 'josh' | 'jenna' = id === 'josh' ? 'josh' : 'jenna';
  return { id, owner, sequence, href: `/outreach?list=${id}&batch=${sequence}`, drafts: focusForOwner(owner, sequence) };
}

/** A shared list is viewable by teammates, but its drafts belong to its assigned sender. */
export function assertListSender(domain: string | null | undefined, viewer: 'josh' | 'jenna') {
 const owner = domain ? batchOwner(domain) : null;
 if (owner && owner !== viewer) throw new Error(`Sign in as ${owner === 'josh' ? 'Josh' : 'Suuchi'} to send prospect emails from this list.`);
}

/** Who may email a card's prospect: the list's assigned sender for list companies, otherwise the card's
 *  assigned owner. Without the second half anyone could send any non-list card from their own mailbox. */
export function assertCardSender(domain: string | null | undefined, assignedTo: string | null | undefined, viewer: 'josh' | 'jenna') {
 assertListSender(domain, viewer);
 if (domain && batchOwner(domain)) return;
 if (assignedTo && assignedTo !== viewer) throw new Error(`This prospect is assigned to ${assignedTo === 'josh' ? 'Josh' : 'Suuchi'}. Sign in as them to send, or reassign the card first.`);
}
