import { allFocus as curatedDrafts } from "./focus-data.ts";
import { localParts } from "./local-time.ts";
import { identityHoldReason, MORNING, rowForecast } from "./morning-send-rules.ts";
import { domainKey } from "./recipient-research.ts";

export type ReachoutSort = "list-order" | "revenue-desc" | "revenue-asc" | "name" | "verified";
export const focusedAccount = (domain?: string | null) => curatedDrafts().find(row => domain && domainKey(row.domain) === domainKey(domain));
/** Headcount-sized rows carry an estimate only for ordering; they show their headcount, never that figure. */
const sizedByHeadcount = (domain?: string | null) => {
  const revenue = focusedAccount(domain)?.revenue as { status?: string; employees?: number } | undefined;
  return revenue?.status === "estimated" && typeof revenue.employees === "number" ? revenue.employees : null;
};
export const revenueLabel = (domain?: string | null) => {
  const employees = sizedByHeadcount(domain);
  if (employees !== null) return `~${employees} employees`;
  const revenue = focusedAccount(domain)?.revenue.usdMillions;
  return revenue == null ? null : `$${Number(revenue.toFixed(1))}M`;
};
/** What the figure is: "revenue" for a reported number, "headcount" when the company is sized by employees. */
export const sizeKind = (domain?: string | null) => (sizedByHeadcount(domain) !== null ? "headcount" : "revenue");
/** The year the revenue was reported for, marked when the source did not confirm it. */
export const revenueYearLabel = (domain?: string | null) => {
  const revenue = focusedAccount(domain)?.revenue as { year?: number | null; status?: string | null } | undefined;
  if (!revenue) return null;
  if (revenue.status === "estimated") return "revenue not published";
  const year = revenue.year ? String(revenue.year) : "year not stated";
  return revenue.status === "unconfirmed" ? `${year} · unconfirmed` : year;
};
/** The nightly AI-fit score for a company, when it has one and is not disqualified. */
export const fitScore = (domain?: string | null) => {
  const fit = (focusedAccount(domain) as { aiFit?: { score?: unknown; disqualified?: unknown } } | undefined)?.aiFit;
  return fit && !fit.disqualified && typeof fit.score === "number" && Number.isFinite(fit.score) ? fit.score : null;
};
const listRank = (domain?: string | null) => {
  const rank = (focusedAccount(domain) as { rank?: unknown } | undefined)?.rank;
  return typeof rank === "number" && Number.isFinite(rank) && rank > 0 ? rank : null;
};
/** Today's list opens in the order the morning run sends it; the curated lists by revenue. */
export const defaultReachoutSort = (batchSequence?: number): ReachoutSort => (batchSequence === 3 ? "list-order" : "revenue-desc");

type Sortable = { accounts: { domain?: string | null; name: string }; people: { email_status: string } };
/** Present values first, compared by `order`; two missing values tie. */
const present = (a: number | null, b: number | null, order: (a: number, b: number) => number) => (a == null || b == null ? (a == null && b == null ? 0 : a == null ? 1 : -1) : order(a, b));
export function sortReachouts<T extends Sortable>(cards: readonly T[], sort: ReachoutSort): T[] {
  return [...cards].sort((a, b) => {
    const names = a.accounts.name.localeCompare(b.accounts.name);
    if (sort === "name") return names;
    if (sort === "list-order") {
      return present(listRank(a.accounts.domain), listRank(b.accounts.domain), (x, y) => x - y)
        || present(fitScore(a.accounts.domain), fitScore(b.accounts.domain), (x, y) => y - x)
        || names;
    }
    const ar = focusedAccount(a.accounts.domain)?.revenue.usdMillions;
    const br = focusedAccount(b.accounts.domain)?.revenue.usdMillions;
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

export type SendState = { kind: "sent" | "blocked" | "kept" | "auto" | "manual"; label: string };
const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const SENT_STATUSES = new Set(["sent", "replied", "positive", "meeting"]);

/**
 * What the morning run is expected to do with a card on Today's list. Display only: the real checks run at
 * send time, so "Auto" and "Needs a hand send" are predictions.
 */
export function sendStateLabel(
  card: { status: string; auto_send_hold?: boolean | null },
  row: unknown,
  blocker: string | null,
  sentAt: string | null,
  options: { sendFrom?: number; sendUntil?: number; timeZone?: string } = {},
): SendState {
  if (sentAt) {
    const when = Date.parse(sentAt);
    return { kind: "sent", label: Number.isFinite(when) ? `Sent ${clock(localParts(new Date(when), options.timeZone).minutes)}` : "Sent" };
  }
  if (SENT_STATUSES.has(card.status)) return { kind: "sent", label: "Sent" };
  if (card.auto_send_hold) return { kind: "kept", label: "Kept for you" };
  if (blocker) return { kind: "blocked", label: blocker.charAt(0).toUpperCase() + blocker.slice(1) };
  const identity = identityHoldReason(row);
  if (identity) return { kind: "manual", label: `Needs a hand send: ${identity}` };
  if (rowForecast(row).send) return { kind: "auto", label: `Auto ${clock(options.sendFrom ?? MORNING.sendFrom)} to ${clock(options.sendUntil ?? MORNING.sendUntil)} (expected)` };
  return { kind: "manual", label: "Needs a hand send: address not confirmed" };
}
