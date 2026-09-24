import { allFocus as curatedDrafts } from "./focus-data.ts";
import { domainKey } from "./recipient-research.ts";

export type ReachoutSort = "revenue-desc" | "revenue-asc" | "name" | "verified";
export const focusedAccount = (domain?: string | null) => curatedDrafts.find(row => domain && domainKey(row.domain) === domainKey(domain));
export const revenueLabel = (domain?: string | null) => {
  const revenue = focusedAccount(domain)?.revenue.usdMillions;
  return revenue == null ? null : `$${Number(revenue.toFixed(1))}M`;
};
type Sortable = { accounts: { domain?: string | null; name: string }; people: { email_status: string } };
export function sortReachouts<T extends Sortable>(cards: readonly T[], sort: ReachoutSort): T[] {
  return [...cards].sort((a, b) => {
    const ar = focusedAccount(a.accounts.domain)?.revenue.usdMillions;
    const br = focusedAccount(b.accounts.domain)?.revenue.usdMillions;
    const names = a.accounts.name.localeCompare(b.accounts.name);
    if (sort === "name") return names;
    if (sort === "verified") {
      const difference = Number(b.people.email_status === "verified") - Number(a.people.email_status === "verified");
      if (difference) return difference;
    }
    if (ar == null || br == null) return ar == null && br == null ? names : ar == null ? 1 : -1;
    return (sort === "revenue-asc" ? ar - br : br - ar) || names;
  });
}

/** Selected companies stay visible after outreach; status is never reset. */
export function reachoutPool<T extends Sortable>(cards: readonly T[], queue: readonly T[]): T[] {
  const selected = cards.filter(card => focusedAccount(card.accounts.domain));
  return selected.length ? selected : [...queue];
}
