import assert from "node:assert/strict";
import test from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { runGroundedSearchAgent, runSearchAgent, setAgentClientForTests } from "./agents.ts";

type Turn = { stop_reason: string; content: unknown[] };
const usage = { input_tokens: 100, output_tokens: 50, server_tool_use: { web_search_requests: 1 } };
const results = (...urls: string[]) => ({ type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: urls.map((url) => ({ type: "web_search_result", url, title: url, page_age: "2026-09-01", encrypted_content: "" })) });

function stub(turns: Turn[]) {
  const calls: Array<{ messages: unknown[]; signal?: AbortSignal }> = [];
  const client = {
    messages: {
      create: async (body: { messages: unknown[] }, options?: { signal?: AbortSignal }) => {
        calls.push({ messages: [...body.messages], signal: options?.signal });
        const turn = turns[Math.min(calls.length - 1, turns.length - 1)];
        return { id: `msg_${calls.length}`, type: "message", role: "assistant", model: "claude-haiku-4-5", usage, ...turn };
      },
    },
  };
  setAgentClientForTests(() => client as unknown as Anthropic);
  return calls;
}

test("sources from every pause_turn round and every web citation are collected", async (t) => {
  t.after(() => setAgentClientForTests(null));
  const calls = stub([
    { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "acme" } }, results("https://acme.com/careers")] },
    { stop_reason: "pause_turn", content: [results("https://www.indeed.com/viewjob?jk=1")] },
    { stop_reason: "end_turn", content: [
      results("https://news.example.org/acme"),
      { type: "text", text: "Acme acquired Smith.", citations: [{ type: "web_search_result_location", url: "https://trade.example.net/acme-smith", title: "Acme buys Smith", cited_text: "Acme acquired Smith", encrypted_index: "" }] },
      { type: "text", text: '{"ok":true}' },
    ] },
  ]);
  const { json, seen } = await runGroundedSearchAgent("research acme", { model: "claude-haiku-4-5", maxSearches: 3 });
  assert.deepEqual(json, { ok: true });
  assert.deepEqual(seen.map((source) => source.url), ["https://acme.com/careers", "https://www.indeed.com/viewjob?jk=1", "https://news.example.org/acme", "https://trade.example.net/acme-smith"]);
  assert.equal(seen[0].page_age, "2026-09-01");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].messages.length, 3, "both paused rounds were sent back as assistant content");
});

test("runSearchAgent keeps returning just the JSON", async (t) => {
  t.after(() => setAgentClientForTests(null));
  stub([{ stop_reason: "end_turn", content: [{ type: "text", text: '{"companies":[]}' }] }]);
  assert.deepEqual(await runSearchAgent("find", { model: "claude-haiku-4-5", maxSearches: 1 }), { companies: [] });
});

test("an aborted signal stops the call before any request", async (t) => {
  t.after(() => setAgentClientForTests(null));
  const calls = stub([{ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] }]);
  const controller = new AbortController();
  controller.abort(new Error("deadline"));
  await assert.rejects(runGroundedSearchAgent("research", { model: "claude-haiku-4-5", maxSearches: 3, signal: controller.signal }), /deadline/);
  assert.equal(calls.length, 0);
});

test("no pause_turn continuation starts once the signal aborts, and the signal reaches the SDK", async (t) => {
  t.after(() => setAgentClientForTests(null));
  const controller = new AbortController();
  const calls = stub([{ stop_reason: "pause_turn", content: [results("https://acme.com/a")] }]);
  const first = calls.length;
  const run = runGroundedSearchAgent("research", { model: "claude-haiku-4-5", maxSearches: 3, signal: controller.signal });
  controller.abort(new Error("deadline"));
  await assert.rejects(run, /deadline/);
  assert.ok(calls.length - first <= 1, "at most the request already in flight");
  assert.equal(calls[0]?.signal, controller.signal);
});
