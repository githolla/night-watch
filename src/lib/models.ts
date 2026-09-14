/**
 * Which Claude models the pipeline uses when nothing is configured, and the
 * web-search tool version each model takes. One place, so an environment
 * override or a retired model changes behaviour in one file.
 */

/**
 * The cheapest current Claude runs everything by default: research, the
 * analysis swarm, the writing and the search agents. One model means one
 * price and one prompt-cache namespace. Set ANTHROPIC_WRITING_MODEL (or
 * ANALYSIS_MODEL, etc.) to a larger model only where the extra quality is
 * worth the extra cents.
 */
export const DEFAULT_RESEARCH_MODEL = "claude-haiku-4-5";

/** The verbatim search agents and the job-board and posts scans. `ANTHROPIC_SEARCH_MODEL` overrides. */
export const DEFAULT_SEARCH_MODEL = "claude-haiku-4-5";

/** Models known to have been retired or renamed; a request for one is retried on the current default. */
const SUPERSEDED = /claude-(3|sonnet-4-5|opus-4-5|opus-4-1|sonnet-4-\d{8}|haiku-3)/i;

export function researchModel() {
  return process.env.ANTHROPIC_RESEARCH_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_RESEARCH_MODEL;
}

export function writingModel() {
  return process.env.ANTHROPIC_WRITING_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_RESEARCH_MODEL;
}

export function utilityModel() {
  return process.env.ANTHROPIC_UTILITY_MODEL ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_RESEARCH_MODEL;
}

export function searchModel() {
  return process.env.ANTHROPIC_SEARCH_MODEL ?? DEFAULT_SEARCH_MODEL;
}

/**
 * The model to try when the configured one is rejected as unknown: the
 * current default, unless that is what failed.
 */
export function fallbackModelFor(model: string): string | null {
  const fallback = process.env.ANTHROPIC_FALLBACK_MODEL ?? DEFAULT_RESEARCH_MODEL;
  return model === fallback ? null : fallback;
}

/** True for a model id this codebase knows to be retired or renamed. Used only for a clearer error message. */
export function isSupersededModel(model: string) {
  return SUPERSEDED.test(model);
}

/**
 * Web search with dynamic filtering (`web_search_20260209`) runs on the 4.6
 * generation and later; older models take the basic tool.
 */
export function webSearchToolType(model: string): "web_search_20260209" | "web_search_20250305" {
  return /claude-(sonnet-5|opus-5|opus-4-[678]|sonnet-4-6|fable|mythos)/i.test(model) ? "web_search_20260209" : "web_search_20250305";
}
