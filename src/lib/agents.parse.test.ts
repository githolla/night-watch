import assert from "node:assert/strict";
import test from "node:test";
import { ModelOutputError, extractJson, finalTextBlock, parseModelJson } from "./model-output.ts";

const answer = { signals: [{ type: "exec_post", summary: "CEO posted about automation", confidence: 0.8 }] };
const example = { signals: [] };

const searchBlocks = (finalText: string) => [
  { type: "text", text: "I'll research Peraton's recent public developments." },
  { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "Peraton AI automation" } },
  { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] },
  { type: "text", text: "The search found a recent LinkedIn post." },
  { type: "text", text: finalText },
];

test("narration then bare JSON parses the answer", () => {
  const blocks = searchBlocks(`Based on the research, here is the result:\n\n${JSON.stringify(answer)}`);
  assert.deepEqual(parseModelJson(blocks, "end_turn"), answer);
});

test("narration then fenced JSON parses the answer", () => {
  const blocks = searchBlocks(`Here is the JSON:\n\n\`\`\`json\n${JSON.stringify(answer, null, 2)}\n\`\`\`\n\nLet me know if you need more.`);
  assert.deepEqual(parseModelJson(blocks, "end_turn"), answer);
});

test("a fenced schema example before the real fenced answer returns the answer", () => {
  const blocks = searchBlocks(
    `The expected shape is:\n\`\`\`json\n${JSON.stringify(example)}\n\`\`\`\n\nAnd the actual result is:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``,
  );
  assert.deepEqual(parseModelJson(blocks, "end_turn"), answer);
});

test("a bare schema example before the bare answer returns the answer", () => {
  const blocks = searchBlocks(`Shape: ${JSON.stringify(example)}. Result: ${JSON.stringify(answer)}`);
  assert.deepEqual(parseModelJson(blocks, "end_turn"), answer);
});

test("a truncated response throws an error naming the stop reason", () => {
  const blocks = searchBlocks('{"signals":[{"type":"exec_post","summary":"CEO posted about automation, and the post goes on');
  assert.throws(
    () => parseModelJson(blocks, "max_tokens"),
    (error: unknown) => error instanceof ModelOutputError && error.code === "truncated" && /stop_reason=max_tokens/.test(error.message),
  );
});

test("prose with no JSON throws a parse error carrying the text and stop reason", () => {
  const blocks = searchBlocks("I could not find any qualifying public development for this company.");
  assert.throws(
    () => parseModelJson(blocks, "end_turn"),
    (error: unknown) =>
      error instanceof ModelOutputError && error.code === "parse" && /stop_reason=end_turn/.test(error.message) && /could not find/.test(error.message),
  );
});

test("a response with no text block throws an empty error", () => {
  assert.throws(
    () => parseModelJson([{ type: "server_tool_use" }], "end_turn"),
    (error: unknown) => error instanceof ModelOutputError && error.code === "empty",
  );
});

test("only the final text block is considered", () => {
  assert.equal(finalTextBlock(searchBlocks("final")), "final");
  assert.equal(finalTextBlock([{ type: "text", text: "  " }]), null);
});

test("braces inside JSON strings do not break span detection", () => {
  const value = { summary: "Post says {hiring} is up", n: 1 };
  assert.deepEqual(extractJson(`Note {not json} then ${JSON.stringify(value)}`), value);
});
