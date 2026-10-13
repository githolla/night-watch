import test from "node:test";
import assert from "node:assert/strict";
import { actionable, briefing, checkedAssessment, companyGroups, configSchema, defaultConfig, problemGroups, score, sourcePlan } from "./domain.ts";
import { itemId } from "./identity.ts";
import { item, assessment, opportunity, now } from "./fixtures.ts";
test("source configuration rejects duplicate IDs and unlicensed feeds", () => {
  assert.equal(configSchema.safeParse({ ...defaultConfig, sources: [...defaultConfig.sources, defaultConfig.sources[0]] }).success, false);
  assert.equal(configSchema.safeParse({ ...defaultConfig, sources: [{ ...defaultConfig.sources[0], provider: "feed", value: "https://publisher.test/rss", permission_reference: "" }] }).success, false);
  assert.equal(configSchema.safeParse({ ...defaultConfig, sources: [{ ...defaultConfig.sources[0], provider: "greenhouse", value: "acme", company: "", domain: "" }] }).success, false);
});
test("evidence must quote the source and limited-context confidence is capped", () => {
  assert.deepEqual(checkedAssessment(assessment, item), assessment);
  assert.throws(() => checkedAssessment({ ...assessment, evidence: [{ quote: "We have a budget of $100000", supports: "Budget" }] }, item), /not present/);
  assert.equal(checkedAssessment(assessment, { ...item, partial: true }).confidence, 0.7);
});
test("canonical URLs deduplicate syndication across collectors while retaining real item identifiers", () => {
  assert.equal(itemId(item), itemId({ ...item, provider: "feed", external_id: "different", url: `${item.url}?utm_source=feed` }));
  assert.notEqual(itemId({ ...item, url: "https://news.ycombinator.com/item?id=1" }), itemId({ ...item, url: "https://news.ycombinator.com/item?id=2" }));
});
test("old, future, expired, inactive and stale evidence cannot enter today's shortlist", () => {
  assert.equal(score(opportunity(), now), 80);
  for (const row of [opportunity({ item: { ...item, active: false } }), opportunity({ item: { ...item, deadline: new Date(now - 1000).toISOString() } }), opportunity({ item: { ...item, published_at: new Date(now + 86400000).toISOString() } }), opportunity({ item: { ...item, published_at: new Date(now - 40 * 86400000).toISOString() } }), opportunity({ checked_at: new Date(now - 8 * 86400000).toISOString() })]) assert.equal(score(row, now), 0);
  assert.equal(actionable(opportunity({ feedback: "irrelevant" }), now), false);
});
test("company corroboration requires human confirmation and does not count duplicate signals", () => {
  assert.equal(companyGroups([opportunity()]).length, 0);
  const row = opportunity({ company_confirmed: true });
  const groups = companyGroups([row, row, opportunity({ id: "second", company_confirmed: true, item: { ...item, provider: "feed", url: "https://acme.com/news/expansion" } })]);
  assert.equal(groups[0].signals.length, 2); assert.equal(groups[0].publishers, 2);
});
test("problem board counts distinct source URLs and honors relevance feedback", () => {
  assert.equal(problemGroups([opportunity(), opportunity({ id: "duplicate" })]).length, 0);
  assert.equal(problemGroups([opportunity(), opportunity({ id: "other", item: { ...item, url: "https://other.test/help" } })])[0].signals.length, 2);
});
test("briefing has a five-item cap and keeps seat follow-ups scoped", () => {
  const rows = Array.from({ length: 8 }, (_, index) => opportunity({ id: String(index) }));
  const due = opportunity({ id: "due", owner: "suuchi", followup_at: new Date(now - 1000).toISOString() });
  assert.equal(briefing([...rows, due], "josh", now).actToday.length, 5);
  assert.equal(briefing([due], "josh", now).followup.length, 0);
  assert.equal(briefing([due], "suuchi", now).followup.length, 1);
});
test("source feedback prioritizes relevance with one rotating exploration source", () => {
  const rows = Array.from({ length: 12 }, (_, index) => opportunity({ id: String(index), source_ids: ["operator_questions"], feedback: "relevant", status: "qualified" }));
  const plan = sourcePlan({ ...defaultConfig, max_sources: 2 }, rows, 0);
  assert.deepEqual(plan.map((source) => source.id), ["business_changes", "operator_questions"]);
});
