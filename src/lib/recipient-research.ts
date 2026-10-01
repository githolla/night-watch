import { researchData } from "#research-data";
import { allFocus } from "./focus-data.ts";
import { derived } from "./research-data/derived.ts";

export const domainKey = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
const personKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const focused = () => allFocus().flatMap(row => row.contacts.map(contact => ({ ...row, buyer: { name: contact.name, title: contact.title, sourceUrl: contact.sourceUrl, email: contact.email }, subject: contact.subject, message: contact.message })));
const research = derived(() => [...focused(), ...researchData().priorityOutreach].map(row => ({ ...row, disposition: "disposition" in row ? row.disposition : "conditional" })));
/** Research about a named buyer must never be retargeted to a colleague. */
export function recipientResearch(domain?: string | null, name?: string | null) {
  if (!domain || !name) return undefined;
  return research().find(row => domainKey(row.domain) === domainKey(domain) && personKey(row.buyer.name) === personKey(name));
}
export function hasResearchCopy(subject: string | null | undefined, body: string | null | undefined, research: { subject: string; message: string }) {
  return subject === research.subject && (body ?? "").replace(/\r\n/g, "\n").includes(research.message);
}
