import assert from "node:assert/strict";
import test from "node:test";
import { ruleForDay, SANDLER_RULES } from "./sandler-quotes.ts";

test("one rule a day, the same all day, a different one tomorrow, cycling through every rule", () => {
  assert.equal(ruleForDay("2026-10-12"), ruleForDay("2026-10-12"));
  assert.notEqual(ruleForDay("2026-10-12"), ruleForDay("2026-10-13"));
  const seen = new Set(Array.from({ length: SANDLER_RULES.length }, (_, index) => ruleForDay(new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10))));
  assert.equal(seen.size, SANDLER_RULES.length);
});
