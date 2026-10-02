import { researchData } from '#research-data';
import { derived } from './research-data/derived.ts';
import { seatOwner } from './types.ts';

// Functions, not constants: in the browser the rows arrive with the page (see research-data/server.ts).
export const originalFocus = () => researchData().revenueFocus;
export const batchFocus = () => researchData().batch2Focus;
export const nextBatchFocus = () => researchData().batch3Focus;
/** Lists built overnight (reachout_lists), already loaded by loadNightlyLists. */
export const nightlyFocus = () => researchData().nightlyFocus;
export const allFocus = derived(() => [...originalFocus(), ...batchFocus(), ...nextBatchFocus(), ...nightlyFocus()]);

/** 1 = First 25, 2 = Next 25, 3 = Today's list (the latest nightly list for that person). */
export type ListSequence = 1 | 2 | 3;

const ownerKey = seatOwner;

export function focusForOwner(owner: string, sequence: ListSequence = 1) {
  const assigned = ownerKey(owner);
  if (sequence === 3) {
    const latest = new Set(assigned ? researchData().nightlyLatest[assigned].map(domain => domain.toLowerCase()) : []);
    return nightlyFocus().filter(row => row.assignedOwner === assigned && latest.has(row.domain.toLowerCase()));
  }
  return (sequence === 2 ? nextBatchFocus() : batchFocus()).filter(row => row.assignedOwner === assigned);
}
export function batchOwner(domain: string): 'josh' | 'suuchi' | null {
  const row = [...batchFocus(), ...nextBatchFocus(), ...nightlyFocus()].find(row => row.domain.toLowerCase() === domain.toLowerCase());
  return row ? row.assignedOwner === 'josh' ? 'josh' : 'suuchi' : null;
}

/** Whether a nightly list is waiting for this person. */
export function hasTodayList(owner: string) {
  return focusForOwner(owner, 3).length > 0;
}

/** The selected list determines draft identity; sending still requires its owner to sign in. */
export function reachoutList(requested: string | undefined, viewer: 'josh' | 'suuchi', sequence: ListSequence = 1) {
  const id: 'josh' | 'suuchi' = seatOwner(requested) ?? (viewer === 'josh' ? 'josh' : 'suuchi');
  const owner: 'josh' | 'suuchi' = id === 'josh' ? 'josh' : 'suuchi';
  return { id, owner, sequence, href: `/outreach?list=${id}&batch=${sequence === 3 ? 'today' : sequence}`, drafts: focusForOwner(owner, sequence) };
}

/** A shared list is viewable by teammates, but its drafts belong to its assigned sender. */
export function assertListSender(domain: string | null | undefined, viewer: 'josh' | 'suuchi') {
 const owner = domain ? batchOwner(domain) : null;
 if (owner && owner !== viewer) throw new Error(`Sign in as ${owner === 'josh' ? 'Josh' : 'Suuchi'} to send prospect emails from this list.`);
}

/** Who may email a card's prospect: the list's assigned sender for list companies, otherwise the card's
 *  assigned owner. Without the second half anyone could send any non-list card from their own mailbox. */
export function assertCardSender(domain: string | null | undefined, assignedTo: string | null | undefined, viewer: 'josh' | 'suuchi') {
 assertListSender(domain, viewer);
 if (domain && batchOwner(domain)) return;
 if (assignedTo && assignedTo !== viewer) throw new Error(`This prospect is assigned to ${assignedTo === 'josh' ? 'Josh' : 'Suuchi'}. Sign in as them to send, or reassign the card first.`);
}
