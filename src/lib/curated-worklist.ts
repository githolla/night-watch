import drafts from "../../data/priority-outreach.json" with { type: "json" };
import { domainKey } from "./recipient-research.ts";
export const curatedDrafts = drafts;
export const curatedDomains = drafts.map(row => domainKey(row.domain));
export function isCuratedDomain(domain: string | null | undefined) {
  return Boolean(domain && curatedDomains.includes(domainKey(domain)));
}
