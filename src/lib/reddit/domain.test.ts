import test from "node:test";
import assert from "node:assert/strict";
import { accessState, briefing, checkedAnalysis, clusters, defaultConfig, queryPlan, responseAllowed, score } from "./domain.ts";
import { source, analysis, opportunity, now } from "./fixtures.ts";

test("collector refuses incomplete approved access even when an API credential exists", () => {
  assert.equal(accessState({ REDDIT_CLIENT_ID: "present" }).ready, false);
  assert.ok(accessState({}).missing.includes("REDDIT_COMMERCIAL_APPROVAL_REFERENCE"));
});
test("invented quotes and quotes assigned to the wrong source are rejected", () => {
  assert.deepEqual(checkedAnalysis(analysis, source), analysis);
  assert.throws(() => checkedAnalysis({ ...analysis, evidence: [{ source_id: "abc", quote: "I manage operations for our sales team.", supports: "authority" }] }, source), /absent/);
  assert.throws(() => checkedAnalysis({ ...analysis, evidence: [{ source_id: "abc", quote: "We have a million dollar budget", supports: "budget" }] }, source), /absent/);
  assert.equal(checkedAnalysis({ ...analysis, evidence: [{ source_id: "comment1", quote: source.comments[0].text, supports: "Stated operating context" }] }, source).evidence.length, 1);
});
test("freshness is deterministic and locked threads get no response-opportunity points", () => {
  assert.equal(score(analysis, source, now), 84);
  assert.equal(score(analysis, { ...source, locked: true }, now), 72);
  assert.equal(score(analysis, source, now + 4 * 86400000), 69);
});
test("drafting requires reviewed rules, a permitted policy and an unlocked live thread", () => {
  const community = { ...defaultConfig.communities[0], rules: "No promotion. Answer questions helpfully.", rules_checked_at: new Date(now).toISOString(), response_policy: "helpful_only" as const };
  assert.equal(responseAllowed(source, community, now), true);
  assert.equal(responseAllowed(source, { ...community, response_policy: "unknown" }, now), false);
  assert.equal(responseAllowed(source, community, now + 8 * 86400000), false);
  assert.equal(responseAllowed({ ...source, locked: true }, community, now), false);
  assert.equal(responseAllowed({ ...source, deleted: true }, community, now), false);
});
test("problem counts deduplicate discussions and exclude irrelevant feedback", () => {
  const first = opportunity();
  assert.equal(clusters([first, first]).length, 0);
  const second = opportunity({ id: "second" });
  assert.equal(clusters([first, first, second])[0].count, 2);
  assert.equal(clusters([first, { ...second, feedback: "irrelevant" }]).length, 0);
});
test("morning briefing limits fresh confident opportunities and scopes follow-ups to a seat", () => {
  const rows = Array.from({ length: 8 }, (_, index) => opportunity({ id: String(index) }));
  const due = opportunity({ id: "due", owner: "josh", watched: true, status: "engaged", followup_at: new Date(now - 1000).toISOString() });
  const other = { ...due, id: "other", owner: "suuchi" as const };
  const changed = { ...due, id: "changed", followup_at: null, changed_at: new Date(now).toISOString() };
  const result = briefing([...rows, due, other, changed, opportunity({ id: "uncertain", analysis: { ...analysis, confidence: 0.5 } }), opportunity({ id: "lowfit", analysis: { ...analysis, fit: 0, help: 0 } })], "josh", now);
  assert.equal(result.actToday.length, 5);
  assert.deepEqual(result.followup.map((row) => row.id), ["due", "changed"]);
  assert.equal(briefing([opportunity({ source: { ...source, created_at: new Date(now - 4 * 86400000).toISOString() } })], "josh", now).actToday.length, 0);
});
test("feedback improves query priority while reserving one rotating exploration query", () => {
  const config = { ...defaultConfig, max_queries: 2 };
  const rows = Array.from({ length: 20 }, (_, index) => opportunity({ id: String(index), query_ids: ["friction"], feedback: "relevant", status: "qualified" }));
  const plan = queryPlan(config, rows, 0);
  assert.deepEqual(plan.map((query) => query.id), ["buying", "friction"]);
  assert.equal(queryPlan({ ...config, queries: [] }, rows, 0).length, 0);
});
