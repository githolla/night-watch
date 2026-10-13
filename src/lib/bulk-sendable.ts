import { addressIdentityProblem } from "./address-identity.ts";
/** Bulk outreach requires mailbox verification; publication and inferred formats stay held. */
export function bulkSendable(person: { email?: string | null; email_status?: string | null; email_source?: string | null; full_name?: string | null; email_check?: unknown }) {
  if (!sendableAddress(person)) return false;
  const check = person.email_check as { source?: unknown; level?: unknown; email?: unknown } | null;
  if (person.full_name && addressIdentityProblem(person.email!, person.full_name)) return false;
  if (check?.level && check.email === person.email && check.level !== "deliverable") return false;
  return person.email_status === "verified" && !["published", "pattern", "guess", "manual"].includes(person.email_source ?? "") && check?.source !== "research";
}

/** A human may send an unconfirmed address, but negative history always blocks it. */
export function sendableAddress(person: { email?: string | null; email_status?: string | null; email_check?: unknown }) {
  if (!person.email || person.email_status === "invalid") return false;
  const check = person.email_check as { bouncedEmails?: unknown; bouncedEmail?: unknown; level?: unknown; email?: unknown } | null | undefined;
  const email = person.email.toLowerCase();
  if (Array.isArray(check?.bouncedEmails) && check.bouncedEmails.some((value: unknown) => typeof value === "string" && value.toLowerCase() === email)) return false;
  if (String(check?.bouncedEmail ?? "").toLowerCase() === email) return false;
  return !(check?.level === "undeliverable" && String(check.email ?? email).toLowerCase() === email);
}
