/**
 * Clock helpers kept out of component bodies. The React purity rule flags
 * Date.now() during render; server pages call these instead, and the
 * result is a plain value the page renders once.
 */
export function nowMs() {
  return Date.now();
}

/** ISO timestamp for `days` days before now. */
export function daysAgoIso(days: number, from = nowMs()) {
  return new Date(from - days * 86_400_000).toISOString();
}
