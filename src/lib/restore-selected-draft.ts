import type { SupabaseClient } from '@supabase/supabase-js';
import { isSelectedDraft, wasAutomaticallyArchived } from './curated-card-state.ts';

/** Recover an automated shortlist retirement, never a user decision or contacted person. */
export async function restoreSelectedDraft(db: SupabaseClient, id: string, explicit = false, options?: { expectedUpdatedAt?: string; onRestored?: (updatedAt: string) => void }) {
  const { data: card, error } = await db.from('cards')
    .select('id,status,updated_at,dismiss_reason,score_breakdown,person_id,accounts(domain,status),signals(hash),people(do_not_contact)')
    .eq('id', id).single();
  if (error) throw error;
  if (!card) throw new Error('Card not found');
  const account = card.accounts as unknown as { domain: string; status: string } | null;
  const signal = card.signals as unknown as { hash: string } | null;
  const person = card.people as unknown as { do_not_contact: boolean } | null;
  if (!account || account.status !== 'active' || !person || person.do_not_contact ||
      !isSelectedDraft(account.domain, signal?.hash) || card.status !== 'archived' || (!explicit && !wasAutomaticallyArchived(card))) {
    if (explicit) throw new Error('This draft cannot be restored. Check the company and contact restrictions.');
    return card.status as string;
  }
  if(options?.expectedUpdatedAt && card.updated_at !== options.expectedUpdatedAt)throw new Error('This draft changed in another session. Your edits are preserved; review the saved draft before retrying.');
  const { count, error: touchError } = await db.from('touches').select('id', { count: 'exact', head: true }).eq('person_id', card.person_id);
  if (touchError) throw touchError;
  if (count === null || count === undefined || count > 0) {
    if (explicit) throw new Error('Outreach is already recorded or could not be checked. Review this contact in History before sending again.');
    return card.status as string;
  }
  let update = db.from('cards').update({ status: 'edited', dismiss_reason: null }).eq('id', id).eq('status', 'archived');
  if(card.updated_at)update=update.eq('updated_at',card.updated_at);
  update = card.dismiss_reason ? update.eq('dismiss_reason', card.dismiss_reason) : update.is('dismiss_reason', null);
  const { data: restored, error: restoreError } = await update.select('status,updated_at').maybeSingle();
  if (restoreError) throw restoreError;
  if (!restored) throw new Error('This draft changed. Reload before continuing.');
  if(restored.updated_at)options?.onRestored?.(restored.updated_at);
  return restored.status as string;
}
