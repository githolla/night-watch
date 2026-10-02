import test from "node:test";
import assert from "node:assert/strict";
import { classifyReply } from "./agents.ts";

test("a reply is still classified, as neutral, when the Anthropic key is missing, so it stops the follow-ups", async () => {
  const previous = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try { assert.equal(await classifyReply("Thanks, let's talk next week."), "neutral"); }
  finally { if (previous !== undefined) process.env.ANTHROPIC_API_KEY = previous; }
});
