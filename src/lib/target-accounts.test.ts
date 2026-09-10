import assert from "node:assert/strict";
import test from "node:test";
import { targetAccountRows, targetAccounts } from "./target-accounts.ts";

test("target universe contains 100 unique qualified companies", () => {
  assert.equal(targetAccounts.length, 100);
  assert.equal(new Set(targetAccounts.map((account) => account.domain)).size, 100);
  assert.ok(targetAccounts.every((account) => account.revenueUsdBillions >= 0.05));
});

test("every target produces a complete nightly research row", () => {
  const rows = targetAccountRows();
  assert.equal(rows.length, 100);
  assert.ok(rows.every((row) => row.status === "active"));
  assert.ok(rows.every((row) => row.target_titles.length === 3));
  assert.ok(rows.every((row) => row.news_query.includes(row.name)));
});
