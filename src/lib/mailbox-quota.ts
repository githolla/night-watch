import type { SupabaseClient } from '@supabase/supabase-js';
import type { Owner } from './types';
import { DeliveryError, deliveryReservationId } from './delivery-state';

export const QUOTA_GOAL = 'Delivery quota reservation';
/** Existing primary-key uniqueness allocates a mailbox-wide daily slot across workers.
 * Confirmed and unknown sends retain their slot. No expiry permits an uncertain duplicate.
 * Historical sends without slots occupy the first `count` positions conservatively.
 */
export async function withMailboxQuota<T>(db: SupabaseClient, input: {
  owner: Owner; cardId: string; personId: string; count: number; cap: number; dayStart: Date; reservationId: string;
}, deliver: () => Promise<T>): Promise<T> {
  if (!Number.isInteger(input.count) || input.count < 0 || !Number.isInteger(input.cap) || input.cap < 1) throw new Error('Cannot verify the daily sending limit. Nothing was sent.');
  let slot: string | undefined;
  for (let index = input.count; index < input.cap; index++) {
    const id = deliveryReservationId(`quota:${input.owner}:${input.dayStart.toISOString()}`, String(index));
    const { error } = await db.from('message_experiments').insert({ id, card_id: input.cardId, person_id: input.personId, owner: input.owner, channel: 'email', goal: QUOTA_GOAL, model: 'saved-email-v1', status: 'selected', context: JSON.stringify({ reservationId: input.reservationId }) });
    if (!error) { slot = id; break; }
    if (error.code !== '23505') throw new Error('Could not reserve daily sending capacity. Nothing was sent. Try again later.');
  }
  if (!slot) throw new Error(`Daily sender cap of ${input.cap} reached or reserved by sends awaiting confirmation.`);
  try { return await deliver(); }
  catch (error) {
    if (!(error instanceof DeliveryError && error.code === 'delivery_unknown')) {
      const { error: releaseError } = await db.from('message_experiments').delete().eq('id', slot).eq('goal', QUOTA_GOAL);
      if (releaseError) throw new Error('This request did not send, but its capacity reservation needs review. Open Delivery recovery before retrying.');
    }
    throw error;
  }
}
