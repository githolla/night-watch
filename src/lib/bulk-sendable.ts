/**
 * Whether Send all may include this person: a verified address, or one researched and marked likely
 * (built from the company's proven format, on a domain that takes mail) for this exact address.
 */
export function bulkSendable(person: { email?: string | null; email_status?: string | null; email_check?: unknown }) {
  if (!person.email || person.email_status === "invalid") return false;
  if (person.email_status === "verified") return true;
  const check = person.email_check as { likely?: unknown; email?: unknown } | null | undefined;
  return check?.likely === true && String(check.email ?? "").toLowerCase() === person.email.toLowerCase();
}
