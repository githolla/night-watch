import test from "node:test";
import assert from "node:assert/strict";
import { evidenceCsv } from "./export.ts";
import { item, opportunity } from "./fixtures.ts";
test("evidence export retains attribution and prevents spreadsheet formula execution", () => {
  const csv = evidenceCsv([opportunity({ item: { ...item, title: ' =HYPERLINK("https://evil.test")' }, notes: "Private notes should not be exported" })]);
  assert.match(csv, /"' =HYPERLINK\(""https:\/\/evil.test""\)"/);
  assert.ok(csv.includes(item.url)); assert.ok(csv.includes("Interest in a vendor")); assert.ok(!csv.includes("Private notes"));
});
