/** Merge only acknowledged fields, never a server's entire stale card snapshot. */
export function acknowledgedDraftFields(values: Record<string, unknown>, response: Record<string, unknown>, submitted: Record<string, number>, current: Record<string, number>) {
  const fields: Record<string, unknown> = {};
  for (const key of Object.keys(values)) {
    if (key.startsWith('saved_variant_') || key === 'reopen') continue;
    if ((submitted[key] ?? 0) === (current[key] ?? 0)) fields[key] = response[key] ?? values[key];
  }
  if (response.updated_at) fields.updated_at = response.updated_at;
  return fields;
}
export function meetingTimesBody(body: string, labels: string[]) {
  const paragraphs = body.trim().split(/\n\s*\n/);
  const questionIndex = paragraphs.findLastIndex(p => p.includes('?'));
  const intro = (questionIndex >= 0 ? paragraphs.slice(0, questionIndex) : paragraphs).join('\n\n');
  return `${intro}\n\nAvailable times:\n${labels.map(label => `• ${label}`).join('\n')}\n\nWould one of these times work for a short call?`;
}

/** Statuses a draft can still be written to — mirrors the PATCH route's allowlist. */
export const EDITABLE_DRAFT_STATUSES = ['new', 'approved', 'edited'];
const DRAFT_TEXT_FIELDS = ['email_subject', 'email_body', 'linkedin_subject', 'linkedin_message'];

/**
 * Decide what to do when a guarded save is rejected because the row moved underneath it.
 *
 * Every write to a card bumps `updated_at` (there is a trigger on the table), and background work writes
 * to cards while somebody is typing: the nightly rescore, the draft repair pass that runs on every
 * /outreach load, worklist stamping. So a rejection almost always means a JOB touched the row, not that a
 * teammate retyped the draft — and the operator was left unable to save (their text was already stored
 * from an earlier blur, so the failure read as a false negative) and then unable to send, because the send
 * button refuses while a field is unsaved.
 *
 * Retry once against the version we just read, keeping the operator's words. Say so when the stored copy
 * carried different text, so a replacement is never silent. A card that has LEFT the editable statuses
 * (it was sent, dismissed, snoozed) is a real conflict: never write over it.
 */
export function resolveSaveConflict(
  values: Record<string, unknown>,
  saved: { status: string; updated_at: string } & Record<string, unknown> | null,
) {
  if (!saved?.updated_at || !EDITABLE_DRAFT_STATUSES.includes(saved.status)) return { retry: false, replaced: false };
  const replaced = DRAFT_TEXT_FIELDS.some(key => key in values && (saved[key] ?? '') !== (values[key] ?? ''));
  return { retry: true, replaced, version: saved.updated_at };
}
