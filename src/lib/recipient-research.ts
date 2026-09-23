import priority from "../../data/priority-outreach.json" with { type: "json" };

export const domainKey = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];
const personKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const research = priority.map(row => ({ ...row, disposition: "disposition" in row ? row.disposition : "conditional" }));
/** Research about a named buyer must never be retargeted to a colleague. */
export function recipientResearch(domain?: string | null, name?: string | null) {
  if (!domain || !name) return undefined;
  return research.find(row => domainKey(row.domain) === domainKey(domain) && personKey(row.buyer.name) === personKey(name));
}
export function hasResearchCopy(subject: string | null | undefined, body: string | null | undefined, research: { subject: string; message: string }) {
  return subject === research.subject && (body ?? "").replace(/\r\n/g, "\n").includes(research.message);
}
