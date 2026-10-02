import assert from "node:assert/strict";
import test from "node:test";
import { SECTORS, sectorsForNight } from "./list-sectors.ts";

test("a sector with a high learned weight becomes the night's best", () => {
  assert.equal(sectorsForNight(0, { "9": 1.5 })[0], 9);
});

test("with no weights the base order decides: sector 0 is best on even days", () => {
  for (const day of [0, 2, 4, 100]) assert.equal(sectorsForNight(day, {})[0], 0);
  assert.equal(sectorsForNight(1, {})[0], 1, "the runner-up on odd days, so the best is not searched two nights running");
});

test("over any 10 nights the explore slot visits every sector and never repeats the best", () => {
  for (const start of [0, 7, 1234]) {
    const explored = new Set<number>();
    for (let day = start; day < start + 10; day++) {
      const [best, explore] = sectorsForNight(day, {});
      assert.notEqual(best, explore);
      explored.add(explore);
    }
    assert.equal(explored.size, SECTORS.length, `from day ${start}`);
  }
});

test("weights never put the same sector in both slots", () => {
  const weights = { "3": 1.5, "7": 1.4, "0": 0.7 };
  for (let day = 0; day < 30; day++) {
    const [best, explore] = sectorsForNight(day, weights);
    assert.notEqual(best, explore);
  }
});
