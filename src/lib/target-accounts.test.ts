import assert from "node:assert/strict";
import test from "node:test";
import { activeTargetAccounts, outreachAccounts, targetAccountRowBatches, targetAccountRows, targetAccounts } from "./target-accounts.ts";

test("target universe contains the full unique $50M+ company list", () => {
  assert.equal(targetAccounts.length, 1859);
  assert.equal(new Set(targetAccounts.map((account) => account.domain)).size, 1859);
  assert.ok(targetAccounts.every((account) => account.revenueEstimateUsdM === null || account.revenueEstimateUsdM >= 50));
  assert.ok(targetAccounts.every((account) => /^(50-100M|100-250M|250-500M|500M-1B|1-5B|5B\+)$/.test(account.revenueBand)));
  assert.ok(targetAccounts.every((account) => account.sourceUrl.startsWith("http")));
});

test("every target produces a complete nightly research row", () => {
  const rows = targetAccountRows();
  assert.equal(rows.length, 1859);
  assert.ok(rows.every((row) => row.status === (row.tier === "removed" ? "paused" : "active")));
  assert.ok(rows.every((row) => row.target_titles.length >= 1));
  assert.ok(rows.every((row) => row.news_query.includes(row.name)));
});

test("the full target universe is split into safe sync batches", () => {
  const batches = targetAccountRowBatches();
  assert.equal(batches.length, 10);
  assert.equal(batches.flat().length, 1859);
  assert.ok(batches.every((batch) => batch.length <= 200));
});

test("the reach-out cut tags every company and keeps only Tier A for outreach", () => {
  const byTier = new Map<string, number>();
  for (const account of targetAccounts) byTier.set(account.tier, (byTier.get(account.tier) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries([...byTier].sort()), { A1: 294, A2: 282, B: 764, C: 223, removed: 296 });
  assert.equal(outreachAccounts.length, 576);
  assert.ok(outreachAccounts.every((account) => account.outreach && (account.tier === "A1" || account.tier === "A2")));
  assert.ok(targetAccounts.every((account) => account.outreach === (account.tier === "A1" || account.tier === "A2")));
  assert.ok(targetAccounts.filter((account) => account.tier === "removed").every((account) => account.dropReason));
  assert.ok(targetAccounts.filter((account) => account.tier !== "removed").every((account) => !account.dropReason));
  assert.equal(activeTargetAccounts.length, 1859 - 296);
  // A1 sorts ahead of A2 so the first wave is at the top of the reach-out list.
  assert.equal(outreachAccounts[0].tier, "A1");
  assert.equal(outreachAccounts[outreachAccounts.length - 1].tier, "A2");
});
