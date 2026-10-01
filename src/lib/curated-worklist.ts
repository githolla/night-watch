import { batchFocus, nextBatchFocus, originalFocus } from "./focus-data.ts";
import { domainKey } from "./recipient-research.ts";
import { derived } from "./research-data/derived.ts";
export const curatedDrafts = originalFocus;
export const curatedDomains = derived(() => curatedDrafts().map(row => domainKey(row.domain)));
/** Hand-curated lists only. Copy built overnight and sent automatically keeps the reply-no opt-out line. */
const handCurated = derived(() => [...originalFocus(), ...batchFocus(), ...nextBatchFocus()]);
export function isCuratedDomain(domain: string | null | undefined) {
  return Boolean(domain && handCurated().some(row => domainKey(row.domain) === domainKey(domain)));
}
