import focus from "../../data/revenue-focus.json" with { type: "json" };

const key = (value: string) => value.trim().toLowerCase();
export function focusedContacts(domain: string) {
  return focus.find(row => key(row.domain) === key(domain))?.contacts ?? [];
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
  if (contact.email && contact.emailSourceUrl && (contact.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`) || (domain === "wolverinetruckgroup.com" && contact.email.endsWith("@wolverinefordsales.com")))) {
    return { email: contact.email, email_status: "unverified", email_source: contact.emailStatus === "inferred" ? "pattern" : contact.emailSourceUrl, email_verified_at: null };
  }
  return inferred ? { email: null, email_status: "none", email_source: null, email_verified_at: null } : {};
}
