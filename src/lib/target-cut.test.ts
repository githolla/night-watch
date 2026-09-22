import assert from "node:assert/strict";
import test from "node:test";
import { isOutreachTier, sellsThisService, targetAccounts } from "./target-accounts.ts";

test("companies that sell this service themselves are off the reach-out list", () => {
  // "We build and run that work so you don't hire for it" IS the managed-services pitch, the AI/data
  // consultancy pitch, and what a staffing firm is for. An audit found 29.7% of everything being emailed
  // was a firm of exactly that kind — including Quantiphi, which this app was being demoed against.
  for (const name of [
    "Quantiphi", "Fractal Analytics", "Tredence", "phData", "Blend360", "Cuesta Partners",
    "Datavail", "Denodo", "Inovalon", "Merative", "Health Catalyst", "Innovaccer", "Arcadia",
    "Amplitude", "6sense", "Eightfold AI", "Vaco", "Cielo", "Eliassen Group", "Bullhorn",
  ]) {
    const account = targetAccounts.find((row) => row.name === name);
    assert.ok(account, `${name} should be on the file`);
    assert.equal(account!.outreach, false, `${name} should not be emailed — ${account!.vertical} / ${account!.subSegment}`);
    assert.equal(account!.sellsThisService, true, `${name} should be flagged as selling this service`);
  }
});

test("the cut removes the competitors and leaves the real buyers", () => {
  const tierA = targetAccounts.filter((row) => isOutreachTier(row.tier));
  const excluded = tierA.filter((row) => row.sellsThisService);
  const emailed = tierA.filter((row) => row.outreach);

  assert.equal(excluded.length + emailed.length, tierA.length, "every Tier A company is either cut or kept");
  // Sized so a change to the rule that quietly guts or un-guts the list fails here rather than in the wild.
  assert.ok(excluded.length > 100 && excluded.length < 200, `expected roughly 130 cut, got ${excluded.length}`);
  assert.ok(emailed.length > 380 && emailed.length < 500, `expected roughly 440 kept, got ${emailed.length}`);

  // Every IT services and consulting firm on the reach-out list goes: they sell this.
  for (const row of tierA) {
    if (/^(IT services|Consulting firms)$/i.test(row.vertical)) {
      assert.equal(row.outreach, false, `${row.name} (${row.vertical}) should be cut`);
    }
  }
});

test("ordinary operating companies are untouched by the rule", () => {
  // The rule reads the recorded vertical and sub-segment only, never the company name, and must not take
  // out a retailer, a bank, a manufacturer or a healthcare provider that merely mentions data.
  for (const [vertical, subSegment] of [
    ["Retail", "specialty apparel"],
    ["Banking", "regional commercial bank"],
    ["Manufacturing", "industrial components"],
    ["Healthcare", "physician practice group"],
    ["Insurance", "property casualty carrier"],
    ["Accounting", "regional CPA firm"],
    ["Legal services", "full-service law firm"],
    ["SaaS", "field service management"],
    ["Logistics", "third-party logistics"],
  ] as const) {
    assert.equal(sellsThisService(vertical, subSegment), false, `${vertical} / ${subSegment} should be kept`);
  }
});
