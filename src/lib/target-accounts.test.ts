import assert from "node:assert/strict";
import test from "node:test";
import { targetAccountRowBatches, targetAccountRows, targetAccounts } from "./target-accounts.ts";

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
  assert.ok(rows.every((row) => row.status === "active"));
  assert.ok(rows.every((row) => row.target_titles.length >= 1));
  assert.ok(rows.every((row) => row.news_query.includes(row.name)));
});

test("the full target universe is split into safe sync batches", () => {
  const batches = targetAccountRowBatches();
  assert.equal(batches.length, 10);
  assert.equal(batches.flat().length, 1859);
  assert.ok(batches.every((batch) => batch.length <= 200));
});
