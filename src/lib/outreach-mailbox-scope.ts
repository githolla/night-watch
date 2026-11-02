export function mailboxAddresses(value: string) {
  return [...value.matchAll(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}/gi)].map(match => match[0].toLowerCase());
}
export function internalOutreachContact(email: string | null | undefined, domain: string | null | undefined, ownEmails: ReadonlySet<string>) {
  const address = email?.trim().toLowerCase() ?? "";
  const host = address.split("@")[1];
  const ownDomains = new Set([...ownEmails].map(email => email.toLowerCase().split("@")[1]).filter(Boolean));
  return !address || ownEmails.has(address) || Boolean(host && ownDomains.has(host)) || Boolean(domain && /(?:^|\.)invalid$/i.test(domain));
}
export function prospectReplySender(from: string, email: string | null | undefined, ownEmails: ReadonlySet<string>) {
  const addresses = mailboxAddresses(from);
  return addresses.length === 1 && addresses[0] === email?.trim().toLowerCase() && !ownEmails.has(addresses[0]);
}
