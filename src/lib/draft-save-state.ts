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
