import type { SupabaseClient } from '@supabase/supabase-js';
import { isSelectedDraft, wasAutomaticallyArchived } from './curated-card-state.ts';

/** Recover an automated shortlist retirement, never a user decision or contacted person. */
export async function restoreSelectedDraft(db: SupabaseClient, id: string) {
  const { data: card, error } = await db.from('cards')
    .select('id,status,dismiss_reason,score_breakdown,person_id,accounts(domain,status),signals(hash),people(do_not_contact)')
    .eq('id', id).single();
  if (error) throw error;
  if (!card) throw new Error('Card not found');
  const account = card.accounts as unknown as { domain: string; status: string } | null;
  const signal = card.signals as unknown as { hash: string } | null;
  const person = card.people as unknown as { do_not_contact: boolean } | null;
  if (!account || account.status !== 'active' || !person || person.do_not_contact ||
      !isSelectedDraft(account.domain, signal?.hash) || !wasAutomaticallyArchived(card)) return card.status as string;
  const { count, error: touchError } = await db.from('touches').select('id', { count: 'exact', head: true }).eq('person_id', card.person_id);
  if (touchError) throw touchError;
  if (count === null || count === undefined || count > 0) return card.status as string;
  let update = db.from('cards').update({ status: 'edited', dismiss_reason: null }).eq('id', id).eq('status', 'archived');
  update = card.dismiss_reason ? update.eq('dismiss_reason', card.dismiss_reason) : update.is('dismiss_reason', null);
  const { data: restored, error: restoreError } = await update.select('status').maybeSingle();
  if (restoreError) throw restoreError;
  if (!restored) throw new Error('This draft changed. Reload before continuing.');
  return restored.status as string;
}
