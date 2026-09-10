import assert from "node:assert/strict";
import test from "node:test";
import { anthropicCost } from "./anthropic-cost.ts";

test("Haiku usage includes tokens and paid web searches", () => {
  const cost = anthropicCost({
    input_tokens: 10_000,
    output_tokens: 1_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    inference_geo: "global",
    server_tool_use: { web_search_requests: 3, web_fetch_requests: 1 },
    service_tier: "standard",
  }, "claude-haiku-4-5");

  assert.equal(cost, 0.045);
});

test("unknown models are costed conservatively", () => {
  const cost = anthropicCost({
    input_tokens: 1_000,
    output_tokens: 1_000,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cache_creation: null,
    inference_geo: null,
    server_tool_use: null,
    service_tier: null,
  }, "future-model");

  assert.equal(cost, 0.06);
});
