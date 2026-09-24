import { researchVersions, authoredResearchVersions, researchRecommendation, type ResearchVersion } from "./research-recommendation.ts";
import archivedEmail from "../../data/outreach-variants-archive.json" with { type: "json" };
import archivedLinkedIn from "../../data/linkedin-variants-archive.json" with { type: "json" };
import { allFocus as focus } from "./focus-data.ts";
import { emailStyle } from "./email-style.ts";

export type SavedVariant = ResearchVersion;
const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const domainKey = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
/** Only complete, authored drafts for this exact person may become selector buttons. */
export function savedVariants(domain?: string | null, contactName?: string | null, channel: "email" | "linkedin" = "email"): SavedVariant[] {
  return researchVersions(domain, contactName, channel);
}
export function renderSavedVariant(variant: SavedVariant, contactName: string, senderName: string, greeting = "Hi {first},") {
  const first = senderName.trim().split(/\s+/)[0];
  const message = first ? variant.message.replaceAll("{sender}", first) : variant.message.replaceAll("I'm {sender} at Nine-67", "We're Nine-67");
  const hello = greeting.replace(/\{first\}/gi, contactName.trim().split(/\s+/)[0]).replace(/\{name\}/gi, contactName);
  return { subject: emailStyle(variant.subject), body: emailStyle(`${hello}\n\n${message}`) };
}

/** LinkedIn messages are authored separately and do not carry an email greeting/footer. */
export function renderLinkedInVariant(variant: SavedVariant, senderName: string) {
  const first = senderName.trim().split(/\s+/)[0];
  const message = first ? variant.message.replaceAll("{sender}", first) : variant.message.replaceAll("I'm {sender} at Nine-67", "We're Nine-67");
  return { subject: emailStyle(variant.subject), body: emailStyle(message) };
}

/** Populate a missing current message from authored copy, preserving existing edits. */
export function withDefaultLinkedIn<T extends { status?: string; accounts: { domain?: string | null }; people: { full_name: string }; linkedin_message?: string | null; linkedin_subject?: string | null }>(card: T, senderName: string): T {
  const current = card.linkedin_message?.trim();
  // Email status must not block a missing LinkedIn draft. Preserve existing protected copy.
  if (current && card.status && !['new','edited'].includes(card.status)) return card;
  if (current) {
    const isSame = (v: SavedVariant) => { const rendered = renderLinkedInVariant(v, senderName); return rendered.body.trim() === current && (!card.linkedin_subject?.trim() || card.linkedin_subject === rendered.subject); };
    if (savedVariants(card.accounts.domain, card.people.full_name, 'linkedin').some(isSame)) return card;
    if (!archivedVariants(card.accounts.domain, card.people.full_name, 'linkedin').some(isSame)) return card;
  }
  const recommendation = researchRecommendation(card.accounts.domain, card.people.full_name);
  const variant = savedVariants(card.accounts.domain, card.people.full_name, "linkedin").find(v => v.id === recommendation?.recommended?.id);
  if (!variant) return card;
  const draft = renderLinkedInVariant(variant, senderName);
  return { ...card, linkedin_message: draft.body, linkedin_subject: draft.subject };
}

/** Blank untouched email cards can render immediately without waiting for an admin repair. */
export function withDefaultEmail<T extends { status: string; accounts: { domain?: string | null }; people: { full_name: string }; email_body: string | null; email_subject: string | null }>(card: T, greeting = "Hi {first},"): T {
  if (card.status !== "new" || card.email_body?.trim()) return card;
  const account = focus.find(row => card.accounts.domain && domainKey(row.domain) === domainKey(card.accounts.domain));
  const contact = account?.contacts.find(row => personKey(row.name) === personKey(card.people.full_name));
  if (!contact) return card;
  const hello = greeting.replace(/\{first\}/gi, contact.name.split(/\s+/)[0]).replace(/\{name\}/gi, contact.name);
  return { ...card, email_subject: card.email_subject?.trim() ? card.email_subject : contact.subject, email_body: emailStyle(`${hello}\n\n${contact.message}`) };
}

/** Historical authored copy is recognizable, but never offered as a new choice. */
export function archivedVariants(domain?: string | null, contactName?: string | null, channel: "email" | "linkedin" = "email"): SavedVariant[] {
  if (!domain || !contactName) return [];
  return [...((channel === "linkedin" ? archivedLinkedIn : archivedEmail).find(row => domainKey(row.domain) === domainKey(domain) && personKey(row.contactName) === personKey(contactName))?.variants ?? [])].reverse().concat(authoredResearchVersions(domain, contactName, channel));
}
