import { addressIdentityProblem } from "./address-identity.ts";
import { allFocus as focus } from "./focus-data.ts";

const key = (value: string) => value.trim().toLowerCase();
export function focusedContacts(domain: string) {
  return focus().find(row => key(row.domain) === key(domain))?.contacts ?? [];
}
export function focusedContact(domain: string, name: string) {
  return focusedContacts(domain).find(person => key(person.name) === key(name));
}

type StoredEmail = { email: string | null; email_status?: string; email_source?: string | null; do_not_contact?: boolean };
/** A published business address is evidence, not a deliverability verification. */
export function publishedEmailPatch(domain: string, name: string, stored: StoredEmail) {
  if (stored.do_not_contact || stored.email_status === "verified" || stored.email_status === "invalid") return {};
  const inferred = ["guess", "pattern"].includes(stored.email_source ?? "");
  if (stored.email && !inferred) return {};
  const contact = focusedContact(domain, name);
  if (!contact) return {};
  const publishedAlias: Record<string, string> = {
    'caretakerlandscape.com': 'caretakerinc.com',
    'winterberrygardens.com': 'winterberrygarden.com',
    'hiddencreeklandscaping.com': '2thecreek.com',
  };
  const knownPublishedAlias = contact.emailStatus === 'published_unverified'
    && publishedAlias[domain] && contact.email?.endsWith(`@${publishedAlias[domain]}`);
  if (contact.email && contact.emailSourceUrl && (knownPublishedAlias || contact.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`) || (domain === "wolverinetruckgroup.com" && contact.email.endsWith("@wolverinefordsales.com")) || (contact.emailStatus === "published_unverified" && ["nationwideconstructiongroup.com", "nationalstoragemgmt.com"].includes(domain)))) {
    const patch = { email: contact.email, email_status: "unverified", email_source: contact.emailStatus === "inferred" ? "pattern" : contact.emailSourceUrl, email_verified_at: null };
    // A published role inbox or someone else's address is kept for a person to send by hand, but marked
    // so it never counts as confirmed for an automatic send.
    const problem = addressIdentityProblem(contact.email, name);
    if (!problem) return patch;
    const email = contact.email.toLowerCase();
    return { ...patch, email_check: { email, level: "risky", reason: `${problem} Automatic sends need the person's own address.`, source: "own", status: "unverified", suggestion: null, hunter: null, mailHost: null, checkedAt: new Date().toISOString() } };
  }
  return inferred ? { email: null, email_status: "none", email_source: null, email_verified_at: null } : {};
}
