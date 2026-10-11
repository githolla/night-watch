import assert from "node:assert/strict";
import test from "node:test";
import { THOUGHTS, thoughtForDay } from "./daily-thought.ts";

test("one thought a day, the same all day, a different one tomorrow, cycling through every line", () => {
  assert.equal(thoughtForDay("2026-10-12"), thoughtForDay("2026-10-12"));
  assert.notEqual(thoughtForDay("2026-10-12"), thoughtForDay("2026-10-13"));
  const seen = new Set(Array.from({ length: THOUGHTS.length }, (_, index) => thoughtForDay(new Date(Date.UTC(2026, 9, 1 + index)).toISOString().slice(0, 10))));
  assert.equal(seen.size, THOUGHTS.length);
});
