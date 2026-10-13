import test from "node:test";
import assert from "node:assert/strict";
import { targetMembership, loadTargetCompanies } from "./targets.ts";
import { focusForOwner } from "../focus-data.ts";
import { queryDb } from "../testing/query-db.ts";
import { records } from "./fixtures.ts";
test("map membership follows the owner's actual First 25, Next 25 and latest nightly list", () => {
  const membership = targetMembership("josh");
  for (const sequence of [1, 2, 3] as const) for (const row of focusForOwner("josh", sequence)) assert.ok(membership.has(row.domain.toLowerCase()));
  for (const row of focusForOwner("suuchi", 1)) assert.equal(membership.has(row.domain.toLowerCase()), false);
  assert.equal(membership.has("not-on-any-list.com"), false);
});
test("target inventory excludes unrelated accounts and attaches actual batch membership", async () => {
  const row = focusForOwner("josh", 1)[0];
  const h = queryDb({ accounts: [{ ...records.companies[0], domain: row.domain }, { ...records.companies[0], id: "outside", domain: "not-on-any-list.com" }] });
  const companies = await loadTargetCompanies(h.db, "josh");
  assert.equal(companies.length, 1); assert.equal(companies[0].domain, row.domain); assert.equal(companies[0].outreachList, "First 25"); assert.equal(companies[0].listOwner, "josh");
});
