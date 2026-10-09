import { createHash } from 'node:crypto';
import { savedVariants, archivedVariants, renderSavedVariant, renderLinkedInVariant } from './outreach-variants.ts';
import { outreachBody } from './outreach-ending.ts';

export const SAVED_VERSION_MODEL = 'saved-email-v1';
export type VersionMeta = { actor?: { id: string; name: string; email: string }; schema: typeof SAVED_VERSION_MODEL; channel?: "email" | "linkedin"; versionId: string; label: string; edited: boolean; revision: string; domain: string; personId: string; source: 'selection' | 'gmail' | 'manual' | 'followup' | 'test'; };
export type VersionSnapshot = { subject: string; body: string; dimensions: unknown };
export function versionMeta(value: unknown): VersionMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<VersionMeta>;
  return v.schema === SAVED_VERSION_MODEL && typeof v.label === 'string' && typeof v.versionId === 'string' && typeof v.personId === 'string' && typeof v.domain === 'string' && typeof v.edited === 'boolean' && typeof v.revision === 'string' && ['selection','gmail','manual','followup','test'].includes(v.source ?? '') ? v as VersionMeta : null;
}
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Greeting/signature and the signed-in sender's name are not editorial changes. */
export function copyContent(text: string) {
  const body = outreachBody(text);
  const paragraphs = body.split(/\n\s*\n/);
  if (/^(?:Hi|Hello|Dear|Hey|Good morning|Good afternoon)\b[^\n]*[,!]?$/.test(paragraphs[0])) paragraphs.shift();
  return normalize(paragraphs.join('\n\n').replace(/I'm [^\n.!?]+? at Nine-67/g, "I'm {sender} at Nine-67"));
}
export function identifyVersion(input: { domain: string; personId: string; contactName: string; subject: string; body: string; senderName: string; greeting?: string; source: VersionMeta['source']; channel?: 'email' | 'linkedin' }, selected?: VersionSnapshot | null): VersionMeta {
  const candidates = [...savedVariants(input.domain, input.contactName, input.channel), ...archivedVariants(input.domain, input.contactName, input.channel)];
  const render = (v: (typeof candidates)[number]) => input.channel === "linkedin" ? renderLinkedInVariant(v, input.senderName) : renderSavedVariant(v, input.contactName, input.senderName, input.greeting);
  // The message decides the version. A subject set for every email on the Drafts page (or a new greeting)
  // must not turn a Direct Offer into "Custom", or the version test loses most of its sends.
  const matching = candidates.find(v => { const rendered = render(v); return normalize(rendered.subject) === normalize(input.subject) && copyContent(rendered.body) === copyContent(input.body); })
    ?? candidates.find(v => copyContent(render(v).body) === copyContent(input.body));
  const prior = versionMeta(selected?.dimensions);
  const validPrior = Boolean(input.body.trim()) && prior && prior.personId === input.personId && prior.domain === input.domain && prior.source === 'selection' && (prior.channel ?? 'email') === (input.channel ?? 'email');
  if (validPrior && selected && normalize(selected.subject) === normalize(input.subject) && copyContent(selected.body) === copyContent(input.body)) {
    return { ...prior!, source: input.source, edited: false };
  }
  const revision = (subject: string, body: string) => createHash('sha256').update(`${subject}\n${body}`).digest('hex').slice(0, 12);
  return {
    schema: SAVED_VERSION_MODEL, channel: input.channel ?? "email",
    versionId: matching?.id ?? (validPrior ? prior.versionId : 'custom'),
    label: matching?.label ?? (validPrior ? prior.label : 'Custom / other'),
    edited: !matching && Boolean(validPrior) && !(selected && normalize(selected.subject) === normalize(input.subject) && copyContent(selected.body) === copyContent(input.body)),
    revision: matching ? revision(matching.subject, matching.message) : validPrior ? prior.revision : revision(input.subject, input.body),
    domain: input.domain, personId: input.personId, source: input.source,
  };
}
export function versionLabel(value: unknown) {
  const meta = versionMeta(value);
  return meta ? `${meta.channel === "linkedin" ? "LinkedIn · " : ""}${meta.label}${meta.edited ? ' · edited' : ''}${meta.source === 'followup' ? ' · follow-up' : ''}` : 'Version not recorded';
}
