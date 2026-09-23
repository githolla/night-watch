import test from "node:test";
import assert from "node:assert/strict";
import { accountBrief, primaryFact, isBlank, dateLabel, sourceDomain, compareAccounts, dossierFor } from "./dossier-data.ts";
import { curatedDomains } from "./curated-worklist.ts";
import { curatedDrafts } from "./curated-worklist.ts";
import { outreachQualityFailures } from "./outreach-quality.ts";

test("blank fields and dates never substitute retrieval time for publication", () => {
  for (const value of [null, undefined, "", " ", ".", " . "]) assert.ok(isBlank(value));
  assert.equal(isBlank(0), false);
  assert.equal(dateLabel(null), null);
  assert.equal(sourceDomain("."), null);
  assert.equal(dateLabel(primaryFact("gwelectric.com")?.published_date), "Sep 2, 2026");
  assert.equal(sourceDomain(primaryFact("gwelectric.com")?.source_url), "gwelectric.com");
});
test("contacts come from brief rank order, including both G&W buyers", () => {
  assert.deepEqual(accountBrief("gwelectric.com")?.contacts.map(c => `${c.first_name} ${c.last_name}`), ["Dave Gizewicz", "Christina Knowles"]);
});
test("accounts sort by wave, strength descending, then name", () => {
  const sorted = [...curatedDomains].sort(compareAccounts);
  assert.equal(accountBrief(sorted[0])?.send_wave, 1);
  for (let i = 1; i < sorted.length; i++) {
    const a = accountBrief(sorted[i - 1])!, b = accountBrief(sorted[i])!;
    assert.ok(a.send_wave <= b.send_wave);
    if (a.send_wave === b.send_wave) {
      const strength = (domain: string) => Math.max(...dossierFor(domain)!.signals.map(s => s.strength));
      assert.ok(strength(sorted[i - 1]) >= strength(sorted[i]));
      if (strength(sorted[i - 1]) === strength(sorted[i])) assert.ok(a.company.localeCompare(b.company) <= 0);
    }
  }
});
test("all authored first touches satisfy the reframe and ending gate", () => {
  for (const row of curatedDrafts) {
    assert.deepEqual(outreachQualityFailures(row.message, { requireIntroduction: true, requireAIPositioning: true, reframe: accountBrief(row.domain)?.pain_hypothesis.reframe }, row.subject), [], row.company);
    assert.ok(/(?:We'd build|We build)/.test(row.message), row.company);
  }
});
