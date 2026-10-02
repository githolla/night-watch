import { localPart, PATTERN_KEYS } from "./email-pattern.ts";

/** A shared mailbox rather than a person: sales@, info@, office2@, support.team@. */
const ROLE_LOCAL = /^(info|sales|office|admin|contact|hello|support|service|careers|jobs|hr|accounting|billing|team|marketing|orders|dispatch|estimating|quotes|help|inquiries|mail)([._-]|\d|$)/;

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Why this address may not belong to the named person, or null when it plausibly does. A role inbox never
 * does. Otherwise the local part must be one of the name's address formats, or contain the first or last
 * name (3 letters or more). A name too short to judge is given the benefit of the doubt.
 */
export function addressIdentityProblem(email: string, fullName: string): string | null {
  const address = fold(email.trim());
  const local = address.split("@")[0] ?? "";
  if (!local) return null;
  if (ROLE_LOCAL.test(local)) return `${address} is a shared inbox, not ${fullName.trim() || "the buyer"}'s own address.`;
  const name = fold(fullName);
  if (PATTERN_KEYS.some((key) => localPart(name, key) === local)) return null;
  const words = name.split(",")[0].split(/\s+/).map((word) => word.replace(/[^a-z]/g, "")).filter((word) => word.length >= 3);
  if (!words.length) return null;
  const letters = local.replace(/[^a-z]/g, "");
  const first = words[0], last = words[words.length - 1];
  if (letters.includes(first) || letters.includes(last)) return null;
  return `${address} does not look like ${fullName.trim()}'s address.`;
}
