/**
 * Every tunable of the nightly run lives here, read once per call so a
 * deployment can override it with an environment variable. Nothing else in
 * the codebase may default these numbers independently.
 */

function integer(name: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function decimal(name: string, fallback: number, min: number) {
  const parsed = Number.parseFloat(process.env[name] ?? "");
  return Math.max(min, Number.isFinite(parsed) ? parsed : fallback);
}

/** Companies enqueued per run, scheduled or manual. `NIGHTLY_ACCOUNT_LIMIT`. */
export function nightlyBatchSize() {
  return integer("NIGHTLY_ACCOUNT_LIMIT", 10, 1, 300);
}

/**
 * Days a successfully researched company waits before it is eligible again.
 * Must exceed the cron interval (one day) or the same companies are picked
 * every night. `RESEARCH_COOLDOWN_DAYS`.
 */
export function researchCooldownMs() {
  return integer("RESEARCH_COOLDOWN_DAYS", 7, 1, 365) * 24 * 3600_000;
}

/** Measured Anthropic spend at which one invocation stops and defers the rest. `NIGHTLY_RUN_BUDGET_USD`. */
export function runBudgetUsd() {
  return decimal("NIGHTLY_RUN_BUDGET_USD", 1.25, 0.01);
}

/** Planning figure for one company; caps how many are enqueued per invocation. `NIGHTLY_MAX_COST_PER_ACCOUNT_USD`. */
export function maxCostPerAccountUsd() {
  return decimal("NIGHTLY_MAX_COST_PER_ACCOUNT_USD", 0.12, 0.001);
}

/**
 * Wall-clock budget one invocation may spend before returning with the run
 * still open. The scheduled route has a 300 s window; the manual route is
 * driven by a browser and re-invoked by the run panel until the run closes.
 */
export function timeBudgetMs(kind: "scheduled" | "manual") {
  return kind === "scheduled"
    ? integer("NIGHTLY_TIME_BUDGET_SECONDS", 240, 30, 290) * 1000
    : integer("MANUAL_RUN_TIME_BUDGET_SECONDS", 90, 15, 290) * 1000;
}

/** A run whose heartbeat is older than this is treated as interrupted. */
export const STALE_HEARTBEAT_MS = 10 * 60_000;
