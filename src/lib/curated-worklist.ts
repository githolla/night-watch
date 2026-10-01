import { allFocus, originalFocus } from "./focus-data.ts";
import { domainKey } from "./recipient-research.ts";
import { derived } from "./research-data/derived.ts";
export const curatedDrafts = originalFocus;
export const curatedDomains = derived(() => curatedDrafts().map(row => domainKey(row.domain)));
export function isCuratedDomain(domain: string | null | undefined) {
  return Boolean(domain && allFocus().some(row => domainKey(row.domain) === domainKey(domain)));
}
