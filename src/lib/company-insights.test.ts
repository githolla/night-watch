import assert from "node:assert/strict";
import test from "node:test";
import { fitBreakdown, fitLabel, signalCounts, stageFunnel, topBy, type InsightRow } from "./company-insights.ts";

const row = (extra: Partial<InsightRow>): InsightRow => ({ tier: "A2", outreach: false, stage: "untouched", industry: "SaaS", state: "TX", roles: 0, posts: 0, contacts: 0, verified: 0, changedThisWeek: false, ...extra });
const rows = [
  row({ tier: "A1", outreach: true, stage: "contacted", roles: 2, industry: "Construction", state: "OH" }),
  row({ tier: "A1", outreach: true, stage: "replied", posts: 1, contacts: 3, verified: 1, industry: "Construction", state: "OH" }),
  row({ tier: "A2", outreach: true, changedThisWeek: true }),
  row({ tier: "B", state: "" }),
  row({ tier: "removed" }),
];

test("tiers read as plain fit names, counted with their reach-out share", () => {
  assert.equal(fitLabel("A1"), "Best fit");
  assert.deepEqual(fitBreakdown(rows).map((item) => `${item.key}:${item.total}/${item.onList}`), ["A1:2/2", "A2:1/1", "B:1/0", "C:0/0", "removed:1/0"]);
});

test("the funnel counts only the reach-out list, stage by stage", () => {
  assert.deepEqual(stageFunnel(rows, ["untouched", "contacted", "replied"]).map((item) => item.count), [1, 1, 1]);
});

test("signals and top values count each company once and skip blanks", () => {
  assert.deepEqual(signalCounts(rows), { hiring: 1, posts: 1, contacts: 1, verified: 1, changed: 1 });
  assert.deepEqual(topBy(rows, "state").map((item) => `${item.key}:${item.total}/${item.onList}`), ["OH:2/2", "TX:2/1"]);
  assert.deepEqual(topBy(rows, "industry")[0], { key: "SaaS", total: 3, onList: 1 });
});
