import focus from '../../data/revenue-focus.json' with { type: 'json' };
import { savedVariants, archivedVariants, renderSavedVariant, renderLinkedInVariant } from './outreach-variants.ts';
import { emailStyle } from './email-style.ts';

export type AuthoredSenderInput = {
  body: string;
  domain?: string | null;
  contactName: string;
  senderName: string;
  greeting?: string;
  channel?: 'email' | 'linkedin';
};
export type AuthoredSenderResult = { body: string; matched: boolean; senderConflict: string | null };
const domainKey = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/:?#]/)[0];
const personKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
// Only this self-introduction slot is variable. Every other word must match an authored message.
const normalized = (body: string) => emailStyle(body)
  .replace(/\bI'm (?:\{sender\}|[\p{L}'-]+(?: [\p{L}'-]+)?) at Nine-67/gu, "I'm {sender} at Nine-67")
  .replace(/\s+/g, ' ').trim();

/** Re-personalize unchanged authored copy; never rewrite a manually edited argument. */
export function authoredSenderDraft(input: AuthoredSenderInput): AuthoredSenderResult {
  const channel = input.channel ?? 'email';
  const first = input.senderName.trim().split(/\s+/)[0];
  const candidates = [...savedVariants(input.domain, input.contactName, channel), ...archivedVariants(input.domain, input.contactName, channel)];
  if (channel === 'email' && input.domain) {
    const account = focus.find(row => domainKey(row.domain) === domainKey(input.domain!));
    const contact = account?.contacts.find(row => personKey(row.name) === personKey(input.contactName));
    if (contact) candidates.push({ id: 'default', label: 'Current draft', subject: contact.subject, message: contact.message });
  }
  const body = input.body.trim();
  const lines = body.split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? '';
  // A custom prose paragraph is not a greeting merely because it precedes an authored message.
  const knownGreeting = /^(?:(?:hi|hello|hey|dear|greetings|good morning|good afternoon|good evening)\b[^.!?]{0,100}|[\p{L}'-]+),?$/iu.test(firstLine);
  const prose = channel === 'email' && knownGreeting ? lines.slice(1).join('\n').trim() : body;
  const match = candidates.find(candidate => normalized(candidate.message) === normalized(prose));
  if (match) {
    const rendered = channel === 'linkedin'
      ? renderLinkedInVariant(match, input.senderName)
      : renderSavedVariant(match, input.contactName, input.senderName, input.greeting ?? 'Hi {first},');
    return { body: rendered.body, matched: true, senderConflict: null };
  }
  // For custom/older copy, leave the text intact and require correction of an explicit wrong seat identity.
  const introduced = [...body.matchAll(/\b(?:I'm|I am|I’m)\s+(Josh|Suuchi)(?:\s+[\p{L}'-]+)?(?:,\s*[^.\n]{0,60})?\s+at Nine-67\b/giu)]
    .map(match => match[1]).find(name => name.toLowerCase() !== first?.toLowerCase());
  return {
    body: input.body,
    matched: false,
    senderConflict: introduced ? `This draft introduces ${introduced}, but your sender name is ${first || 'not set'}. Correct the introduction before sending.`
      : body.includes('{sender}') ? 'This edited draft still contains a sender placeholder. Replace it with your name before sending.' : null,
  };
}
