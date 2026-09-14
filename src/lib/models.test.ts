import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RESEARCH_MODEL, fallbackModelFor, isSupersededModel, webSearchToolType } from "./models.ts";

test("the web-search tool version follows the model generation", () => {
  assert.equal(webSearchToolType("claude-sonnet-5"), "web_search_20260209");
  assert.equal(webSearchToolType("claude-opus-4-7"), "web_search_20260209");
  assert.equal(webSearchToolType("claude-sonnet-4-6"), "web_search_20260209");
  assert.equal(webSearchToolType("claude-sonnet-4-5"), "web_search_20250305");
  assert.equal(webSearchToolType("claude-haiku-4-5"), "web_search_20250305");
});

test("a rejected model falls back to the default once, never to itself", () => {
  assert.equal(fallbackModelFor("claude-sonnet-4-5"), DEFAULT_RESEARCH_MODEL);
  assert.equal(fallbackModelFor(DEFAULT_RESEARCH_MODEL), null);
  assert.ok(isSupersededModel("claude-sonnet-4-5"));
  assert.ok(!isSupersededModel("claude-sonnet-5"));
  assert.ok(!isSupersededModel("claude-haiku-4-5"));
});

test("the cheapest current model is the default and takes the basic web-search tool", () => {
  assert.equal(DEFAULT_RESEARCH_MODEL, "claude-haiku-4-5");
  assert.equal(webSearchToolType(DEFAULT_RESEARCH_MODEL), "web_search_20250305");
});
