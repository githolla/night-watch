import assert from "node:assert/strict";
import test from "node:test";
import { cleanRoleTitle, sanitizeCopy } from "./clean.ts";

test("strips ATS requisition ids from a title", () => {
  assert.equal(cleanRoleTitle("Lead Data Engineer A1wuq000001tvyf2ae"), "Lead Data Engineer");
  assert.equal(cleanRoleTitle("AWS Cloud Data Engineer"), "AWS Cloud Data Engineer");
});

test("sanitizeCopy removes embedded req ids from a sentence", () => {
  const raw = "They are hiring 41 roles (Continuous Improvement Lead A1wuq000001ljan2ai, AWS Cloud Data Engineer); Nine-67 could build it.";
  const out = sanitizeCopy(raw);
  assert.ok(!/A1wuq000001ljan2ai/.test(out), "req id should be gone");
  assert.ok(/AWS Cloud Data Engineer/.test(out));
});

test("sanitizeCopy leaves clean copy untouched", () => {
  const clean = "They are hiring 4 roles in data and reporting; Nine-67 could build that instead.";
  assert.equal(sanitizeCopy(clean), clean);
});
