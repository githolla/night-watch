/**
 * Which companies get researched next.
 *
 * The rule that guarantees the list advances: a company that has never been
 * researched always outranks one that has, and among researched companies
 * the one checked longest ago comes first. The static target priority is
 * only a coarse band used to order companies that tie on that rule. Without
 * this the same top N sorted to the front every night, forever.
 */

export type RotationAccount = { domain: string; name: string; last_scouted_at: string | null };

/** Coarse priority band from the supplied target file: 2 for an AI clue, 1 for a named CEO or PE sponsor, 0 otherwise. */
export function priorityBand(context?: { aiSignal?: string; ceo?: string; ownership?: string } | null) {
  if (!context) return 0;
  if (context.aiSignal) return 2;
  if (context.ceo || context.ownership === "PE-backed") return 1;
  return 0;
}

export type SelectionOptions<T> = {
  limit: number;
  cooldownMs: number;
  now?: number;
  bandOf?: (account: T) => number;
};

function scoutedAt(account: RotationAccount) {
  if (!account.last_scouted_at) return null;
  const time = Date.parse(account.last_scouted_at);
  return Number.isNaN(time) ? null : time;
}

/** Companies eligible tonight: never researched, or researched before the cooldown window. */
export function eligibleAccounts<T extends RotationAccount>(accounts: T[], cooldownMs: number, now = Date.now()) {
  const cutoff = now - cooldownMs;
  return accounts.filter((account) => {
    const time = scoutedAt(account);
    return time === null || time < cutoff;
  });
}

/** Order eligible companies: never researched first, then oldest research first; band and name break ties. */
export function orderForResearch<T extends RotationAccount>(accounts: T[], bandOf: (account: T) => number = () => 0) {
  return [...accounts].sort((left, right) => {
    const leftTime = scoutedAt(left);
    const rightTime = scoutedAt(right);
    if (leftTime === null && rightTime !== null) return -1;
    if (leftTime !== null && rightTime === null) return 1;
    if (leftTime !== null && rightTime !== null && leftTime !== rightTime) return leftTime - rightTime;
    const band = bandOf(right) - bandOf(left);
    if (band !== 0) return band;
    return left.name.localeCompare(right.name) || left.domain.localeCompare(right.domain);
  });
}

export function selectResearchBatch<T extends RotationAccount>(accounts: T[], options: SelectionOptions<T>) {
  const limit = Math.max(0, Math.floor(options.limit));
  return orderForResearch(eligibleAccounts(accounts, options.cooldownMs, options.now), options.bandOf).slice(0, limit);
}

/** Nights needed to research every company once at the given batch size. */
export function nightsForFullPass(total: number, batchSize: number) {
  return batchSize > 0 ? Math.ceil(total / batchSize) : Number.POSITIVE_INFINITY;
}
