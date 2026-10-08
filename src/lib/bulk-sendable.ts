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

/**
 * Whether Send all ready and the morning auto-send may email this person: any address not already known to be
 * bad (marked invalid or bounced before). Confirmed or not; the send-time check still refuses a domain with no
 * mail server, and the bounce brake pauses auto-send if guesses start bouncing.
 */
export function sendableAddress(person: { email?: string | null; email_status?: string | null; email_check?: unknown }) {
  if (!person.email || person.email_status === "invalid") return false;
  const check = person.email_check as { bouncedEmail?: unknown; level?: unknown; email?: unknown } | null | undefined;
  const email = person.email.toLowerCase();
  if (String(check?.bouncedEmail ?? "").toLowerCase() === email) return false;
  return !(check?.level === "undeliverable" && String(check.email ?? email).toLowerCase() === email);
}
