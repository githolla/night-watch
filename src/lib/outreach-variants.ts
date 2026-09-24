import archivedEmail from "../../data/outreach-variants-archive.json" with { type: "json" };
import archivedLinkedIn from "../../data/linkedin-variants-archive.json" with { type: "json" };
import focus from "../../data/revenue-focus.json" with { type: "json" };
import variants from "../../data/outreach-variants.json" with { type: "json" };
import linkedinVariants from "../../data/linkedin-variants.json" with { type: "json" };
import { emailStyle } from "./email-style.ts";

export type SavedVariant = typeof variants[number]["variants"][number];
const personKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const domainKey = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
/** Only complete, authored drafts for this exact person may become selector buttons. */
export function savedVariants(domain?: string | null, contactName?: string | null, channel: "email" | "linkedin" = "email"): SavedVariant[] {
  if (!domain || !contactName) return [];
  return ((channel === "linkedin" ? linkedinVariants : variants).find(row => domainKey(row.domain) === domainKey(domain) && personKey(row.contactName) === personKey(contactName))?.variants ?? [])
    .filter(variant => variant.subject.trim() && variant.message.trim());
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
export function withDefaultLinkedIn<T extends { accounts: { domain?: string | null }; people: { full_name: string }; linkedin_message?: string | null; linkedin_subject?: string | null }>(card: T, senderName: string): T {
  if (card.linkedin_message?.trim()) return card;
  const variant = savedVariants(card.accounts.domain, card.people.full_name, "linkedin")[0];
  if (!variant) return card;
  const draft = renderLinkedInVariant(variant, senderName);
  return { ...card, linkedin_message: draft.body, linkedin_subject: card.linkedin_subject?.trim() ? card.linkedin_subject : draft.subject };
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
  return (channel === "linkedin" ? archivedLinkedIn : archivedEmail).find(row => domainKey(row.domain) === domainKey(domain) && personKey(row.contactName) === personKey(contactName))?.variants ?? [];
}
