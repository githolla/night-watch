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
  const searchCost = (usage.server_tool_use?.web_search_requests ?? 0) * 0.01;
  return tokenCost + searchCost;
}

export type UsageRecorder = (costUsd: number) => void;

export function recordAnthropicUsage(
  response: Pick<Anthropic.Messages.Message, "usage">,
  model: string,
  recorder?: UsageRecorder,
) {
  recorder?.(anthropicCost(response.usage, model));
}
