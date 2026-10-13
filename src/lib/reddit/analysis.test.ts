import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import type { UsageRecorder } from "../anthropic-cost.ts";
import * as domain from "./domain.ts";
import { source, analysis } from "./fixtures.ts";
const community = { ...domain.defaultConfig.communities[0], rules: "No links or self promotion.", rules_checked_at: new Date().toISOString(), response_policy: "helpful_only" as const };
function analyzer(outputs: unknown[]) {
  const prompts: string[] = [];
  const exports: { draftResponse?: (source: domain.RedditSource, analysis: domain.RedditAnalysis, community: domain.Community, signal: AbortSignal, usage: UsageRecorder) => Promise<domain.Opportunity["draft"]>; analyze?: (source: domain.RedditSource, signal: AbortSignal, usage: UsageRecorder) => Promise<domain.RedditAnalysis> } = {};
  const mocks: Record<string, unknown> = { "zod": { z }, "./domain.ts": domain, "../agents.ts": { runWritingAgent: async (prompt: string) => { prompts.push(prompt); return outputs.shift(); } }, "../models.ts": { utilityModel: () => "utility", writingModel: () => "writer" } };
    runInNewContext(ts.transpileModule(readFileSync(new URL("./analysis.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Error, JSON, require: (name: string) => mocks[name] });
    return { ...exports, prompts };
}
test("drafting is gated before any model calls when current rules are unknown", async () => {
  const h = await analyzer([]);
  await assert.rejects(h.draftResponse!(source, analysis, { ...community, response_policy: "unknown" }, AbortSignal.timeout(1000), () => {}), /rules/);
  assert.equal(h.prompts.length, 0);
});
test("an independent critic can reject a plausible draft", async () => {
  const h = await analyzer([{ body: "Start by mapping your report inputs and owners. Which step takes longest?", asset_outline: "List inputs, owners and validation checks." }, { approved: false, critique: "Does not address the specified system." }]);
  const result = await h.draftResponse!(source, analysis, community, AbortSignal.timeout(1000), () => {});
  assert.equal(result?.approved, false); assert.equal(h.prompts.length, 2);
  assert.match(h.prompts[1], /actual thread/);
});
test("contact routing and links stay rejected even when the critic mistakenly approves", async () => {
  for (const body of ["DM me and I can help.", "Read https://sales.test for the solution.", "Email us at hello@example.com."]) {
    const h = await analyzer([{ body, asset_outline: "" }, { approved: true, critique: "Looks good" }]);
    assert.equal((await h.draftResponse!(source, analysis, community, AbortSignal.timeout(1000), () => {}))?.approved, false);
  }
});
test("analysis cannot store invented quotations and source instructions are explicitly untrusted", async () => {
  const h = await analyzer([{ ...analysis, evidence: [{ source_id: source.id, quote: "We have a budget of $50000", supports: "Budget" }] }]);
  await assert.rejects(h.analyze!(source, AbortSignal.timeout(1000), () => {}), /absent/);
  assert.match(h.prompts[0], /untrusted source material/);
  assert.match(h.prompts[0], /real identity/);
});
