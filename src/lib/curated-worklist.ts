import { allFocus } from "./focus-data.ts";
import drafts from "../../data/revenue-focus.json" with { type: "json" };
import { domainKey } from "./recipient-research.ts";
export const curatedDrafts = drafts;
export const curatedDomains = drafts.map(row => domainKey(row.domain));
export function isCuratedDomain(domain: string | null | undefined) {
  return Boolean(domain && allFocus.some(row => domainKey(row.domain) === domainKey(domain)));
}
