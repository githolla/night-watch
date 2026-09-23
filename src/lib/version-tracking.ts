import type { SupabaseClient } from '@supabase/supabase-js';
import { senderProfile } from './sender';
import type { Owner } from './types';
import { identifyVersion, SAVED_VERSION_MODEL, versionMeta, type VersionMeta, type VersionSnapshot } from './version-attribution';

/** Reuse existing immutable message snapshot tables; no model calls or schema migration.
 * Each record has one snapshot in slot A. The real four-way label lives in dimensions.
 * These records are excluded from the older A/B simulation statistics.
 */
export async function snapshotVersion(db: SupabaseClient, input: { cardId: string; personId: string; owner: Owner; subject: string; body: string; meta: VersionMeta }) {
  const { data: experiment, error } = await db.from('message_experiments').insert({ card_id: input.cardId, person_id: input.personId, owner: input.owner, channel: 'email', goal: 'Saved email version history', model: SAVED_VERSION_MODEL, status: 'selected', selected_label: 'A' }).select('id').single();
  if (error || !experiment) throw new Error(`Could not save version history: ${error?.message ?? 'missing record'}`);
  const { data: variant, error: variantError } = await db.from('message_variants').insert({ experiment_id: experiment.id, label: 'A', subject: input.subject, body: input.body, dimensions: input.meta, selected: true }).select('id').single();
  if (variantError || !variant) throw new Error(`Could not save email snapshot: ${variantError?.message ?? 'missing record'}`);
  return variant.id as string;
}
export async function trackEmailVersion(db: SupabaseClient, input: { cardId: string; personId: string; owner: Owner; subject: string; body: string; source: 'gmail' | 'manual'; followup?: boolean }) {
  const { data: card, error } = await db.from('cards').select('person_id,active_variant_id,accounts(domain)').eq('id', input.cardId).single();
  if (error || !card) throw new Error('Cannot record version: card unavailable.');
  const { data: person, error: personError } = await db.from('people').select('full_name').eq('id', input.personId).single();
  if (personError || !person) throw new Error('Cannot record version: contact unavailable.');
  const profile = await senderProfile(db, input.owner);
  let selected: VersionSnapshot | null = null;
  if (card.active_variant_id && card.person_id === input.personId) {
    const { data, error: selectionError } = await db.from('message_variants').select('subject,body,dimensions').eq('id', card.active_variant_id).maybeSingle();
    if (selectionError) throw selectionError;
    selected = data;
  }
  const domain = (card.accounts as unknown as { domain: string })?.domain ?? '';
  let meta = identifyVersion({ ...input, domain, contactName: person.full_name, senderName: profile.fromName, greeting: profile.greeting }, selected);
  if (input.followup) {
    const { data: previous, error: previousError } = await db.from('touches').select('message_variants(dimensions)').eq('card_id', input.cardId).eq('person_id', input.personId).eq('sent_by', input.owner).eq('channel', 'email').not('experiment_variant_id', 'is', null).order('sent_at').limit(1).maybeSingle();
    if (previousError) throw previousError;
    const first = versionMeta((previous?.message_variants as unknown as { dimensions: unknown } | null)?.dimensions);
    meta = { ...(first ?? { ...meta, versionId: 'untracked', label: 'Untracked original', edited: false }), source: 'followup' };
  }
  return snapshotVersion(db, { ...input, meta });
}
