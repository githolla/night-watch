import type Anthropic from "@anthropic-ai/sdk";

type Rates = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

function ratesFor(model: string): Rates {
  if (model.includes("haiku-4-5")) return { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 };
  if (model.includes("sonnet-5")) return { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 };
  if (model.includes("sonnet-4")) return { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 };
  if (model.includes("opus")) return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
  // Unknown/future models use a deliberately conservative fallback.
  return { input: 10, output: 50, cacheWrite: 20, cacheRead: 1 };
}

export function anthropicCost(usage: Anthropic.Messages.Usage, model: string) {
  const rates = ratesFor(model);
  const tokenCost = (
    usage.input_tokens * rates.input
    + usage.output_tokens * rates.output
    + (usage.cache_creation_input_tokens ?? 0) * rates.cacheWrite
    + (usage.cache_read_input_tokens ?? 0) * rates.cacheRead
  ) / 1_000_000;
  // Anthropic bills web search and web fetch as server tool use; count both so measured spend isn't understated.
  const serverTools = usage.server_tool_use as (typeof usage.server_tool_use & { web_fetch_requests?: number }) | undefined;
  const searchCost = ((serverTools?.web_search_requests ?? 0) + (serverTools?.web_fetch_requests ?? 0)) * 0.01;
  return tokenCost + searchCost;
}

/**
 * One company's research allowance. Paid web searches and dollars are counted across every model call made
 * for the company (scout, the person lookup, drafting, pause_turn continuations, retries on a fallback
 * model), so ANTHROPIC_MAX_SEARCHES_PER_COMPANY and NIGHTLY_MAX_COST_PER_ACCOUNT_USD are real limits rather
 * than a max_uses on the first request and a planning figure.
 */
export type ResearchBudget = { searchesLeft: number; costCapUsd: number; spentUsd: number };

export function researchBudget(maxSearches: number, costCapUsd: number): ResearchBudget {
  return { searchesLeft: Math.max(0, Math.floor(maxSearches)), costCapUsd, spentUsd: 0 };
}

/** Thrown before a call that the company's allowance cannot cover. Nothing is spent by the refused call. */
export class SpendLimitError extends Error {
  readonly limit: "searches" | "cost";
  constructor(limit: "searches" | "cost", message: string) {
    super(message);
    this.name = "SpendLimitError";
    this.limit = limit;
  }
}

/** Records the cost of each call. A recorder may carry the company's budget; completeTurn enforces it. */
export type UsageRecorder = ((costUsd: number) => void) & { budget?: ResearchBudget };

export function withBudget(recorder: (costUsd: number) => void, budget: ResearchBudget): UsageRecorder {
  return Object.assign((costUsd: number) => recorder(costUsd), { budget });
}

export function recordAnthropicUsage(
  response: Pick<Anthropic.Messages.Message, "usage">,
  model: string,
  recorder?: UsageRecorder,
) {
  recorder?.(anthropicCost(response.usage, model));
}
