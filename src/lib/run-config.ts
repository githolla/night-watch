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
  return integer("NIGHTLY_ACCOUNT_LIMIT", 25, 1, 300);
}

/** Companies whose careers page the sweep reads per run. `SWEEP_ACCOUNT_LIMIT`. */
export function sweepAccountLimit() {
  return integer("SWEEP_ACCOUNT_LIMIT", 300, 1, 2000);
}

/** Hours before a company's careers page is read again. `SWEEP_COOLDOWN_HOURS`. */
export function sweepCooldownMs() {
  return integer("SWEEP_COOLDOWN_HOURS", 24, 1, 720) * 3600_000;
}

/**
 * When a careers page cannot be read, ask a small model to list the company's
 * roles from public job boards. `SWEEP_SEARCH_FALLBACK` (default on),
 * `SWEEP_SEARCH_COOLDOWN_DAYS` (7), `SWEEP_SEARCH_MAX_SEARCHES` (2).
 */
export function sweepSearchFallback() {
  return {
    enabled: (process.env.SWEEP_SEARCH_FALLBACK ?? "true").toLowerCase() !== "false",
    cooldownMs: integer("SWEEP_SEARCH_COOLDOWN_DAYS", 7, 1, 365) * 24 * 3600_000,
    maxSearches: integer("SWEEP_SEARCH_MAX_SEARCHES", 2, 1, 5),
  };
}

/**
 * AI-posts scan inside the sweep: anyone at the company posting publicly about
 * AI or automation in their own work. `SWEEP_AI_POSTS` (default on),
 * `SWEEP_AI_POSTS_COOLDOWN_DAYS` (7), `SWEEP_AI_POSTS_MAX_SEARCHES` (2).
 */
export function sweepAiPosts() {
  return {
    enabled: (process.env.SWEEP_AI_POSTS ?? "true").toLowerCase() !== "false",
    cooldownMs: integer("SWEEP_AI_POSTS_COOLDOWN_DAYS", 7, 1, 365) * 24 * 3600_000,
    maxSearches: integer("SWEEP_AI_POSTS_MAX_SEARCHES", 2, 1, 5),
  };
}

/**
 * Contact enrichment inside the sweep. `SWEEP_CONTACTS`: "hiring" (default)
 * enriches companies with open target roles or AI posts, "all" every company,
 * "off" none. `SWEEP_CONTACTS_COOLDOWN_DAYS` (30), `SWEEP_CONTACTS_PER_COMPANY` (6).
 */
export function sweepContacts() {
  const mode = (process.env.SWEEP_CONTACTS ?? "hiring").toLowerCase();
  return {
    mode: (mode === "all" || mode === "off" ? mode : "hiring") as "hiring" | "all" | "off",
    cooldownMs: integer("SWEEP_CONTACTS_COOLDOWN_DAYS", 30, 1, 365) * 24 * 3600_000,
    perCompany: integer("SWEEP_CONTACTS_PER_COMPANY", 6, 1, 15),
  };
}

/** Measured spend at which one sweep invocation stops; the board search is the only cost. `SWEEP_RUN_BUDGET_USD`. */
export function sweepBudgetUsd() {
  return decimal("SWEEP_RUN_BUDGET_USD", 10, 0.01);
}

/** Careers pages read in parallel by one sweep invocation. `SWEEP_CONCURRENCY`. */
export function sweepConcurrency() {
  return integer("SWEEP_CONCURRENCY", 6, 1, 12);
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
  return decimal("NIGHTLY_RUN_BUDGET_USD", 2.5, 0.01);
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

/**
 * Initial populate: one pass that sweeps the whole list and researches every
 * hiring company with more searches and a larger budget than a nightly run.
 * `POPULATE_MAX_SEARCHES`, `POPULATE_ACCOUNT_LIMIT`, `POPULATE_RUN_BUDGET_USD`.
 */
export function populateConfig() {
  return {
    maxSearches: integer("POPULATE_MAX_SEARCHES", 8, 1, 10),
    accountLimit: integer("POPULATE_ACCOUNT_LIMIT", 2000, 1, 2000),
    budgetUsd: decimal("POPULATE_RUN_BUDGET_USD", 150, 0.01),
  };
}

/**
 * The extensive first pass of the sweep: the research model instead of the
 * small one for the posts and job-board searches, more searches, contacts
 * for every company, no cooldown gating, and a budget that will not
 * interrupt. `POPULATE_SWEEP_BUDGET_USD`, `POPULATE_SWEEP_SEARCHES`.
 */
export function populateSweepConfig() {
  return {
    budgetUsd: decimal("POPULATE_SWEEP_BUDGET_USD", 200, 0.01),
    searches: integer("POPULATE_SWEEP_SEARCHES", 5, 1, 10),
    model: process.env.POPULATE_SWEEP_MODEL ?? process.env.ANTHROPIC_RESEARCH_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  };
}

/** A run whose heartbeat is older than this is treated as interrupted. */
export const STALE_HEARTBEAT_MS = 10 * 60_000;
