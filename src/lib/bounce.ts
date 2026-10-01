/**
 * Delivery failures arrive in the same Gmail thread as the original email, from an address that is not
 * ours, so the reply rule alone counted them as prospect replies: the cadence stopped and the card was
 * marked "replied" for an address that never received anything. Recognise them by sender and subject.
 */
type Header = { name: string; value: string };

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounces?|mailerdaemon)@/i;
const BOUNCE_NAME = /\b(mail delivery (subsystem|system)|mail delivery failure|postmaster)\b/i;
const BOUNCE_SUBJECT = /\b(delivery status notification|undeliverable|undelivered mail|delivery (has )?failed|mail delivery failed|returned mail|failure notice|message not delivered|address not found)\b/i;

function header(headers: Header[], name: string) {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

export function senderAddress(from: string) {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

export function isBounce(headers: Header[]) {
  const from = header(headers, "from");
  const contentType = header(headers, "content-type");
  if (BOUNCE_SENDER.test(senderAddress(from))) return true;
  if (BOUNCE_NAME.test(from.replace(/<[^>]*>/, ""))) return true;
  if (/multipart\/report/i.test(contentType) && /delivery-status/i.test(contentType)) return true;
  // A subject alone is not enough: a person can write "message not delivered?" in a real reply.
  return BOUNCE_SUBJECT.test(header(headers, "subject")) && /daemon|postmaster|delivery|no-?reply/i.test(from);
}
