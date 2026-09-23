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
