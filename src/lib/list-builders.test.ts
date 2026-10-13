import test from "node:test";
import assert from "node:assert/strict";
import { buildersForNight, LIST_BUILDERS, diversifiedResearchQueue, revenueLane } from "./list-builders.ts";
import { inRevenueBand, REVENUE_BAND_TEXT } from "./list-sectors.ts";
import { sizeOf } from "./send-plan.ts";
import { priorScore } from "./ai-fit.ts";
import { sourcingPrompt } from "./nightly-list-rules.ts";
test("company revenue expands through exactly one billion dollars", () => {
  assert.equal(inRevenueBand(10), true); assert.equal(inRevenueBand(1000), true); assert.equal(inRevenueBand(1000.01), false); assert.equal(inRevenueBand(9.99), false);
  assert.equal(REVENUE_BAND_TEXT, "$10M to $1B"); assert.equal(sizeOf({ usdMillions: 700 }), "$500M to $1B"); assert.equal(sizeOf({ usdMillions: 1001 }), "Over $1B");
});
test("every intelligent strategy rotates alongside baseline sourcing", () => {
  const seen = new Set(Array.from({ length: 5 }, (_, day) => buildersForNight(day)[1].id));
  assert.equal(seen.size, LIST_BUILDERS.length - 1); assert.equal(buildersForNight(0)[0].id, "ranked_operators"); assert.notEqual(buildersForNight(0, 1)[1].id, buildersForNight(0)[1].id);
});
test("research explores larger bands without losing priority order inside each band", () => {
  const rows = [{ id: "core1", revenue_usd_m: 40 }, { id: "core2", revenue_usd_m: 60 }, { id: "growth", revenue_usd_m: 200 }, { id: "larger", revenue_usd_m: 900 }, { id: "unknown", revenue_usd_m: null }, { id: "excluded", revenue_usd_m: 1500 }];
  assert.deepEqual(diversifiedResearchQueue(rows, 4).map((row) => row.id), ["core1", "growth", "larger", "unknown"]);
  assert.deepEqual(diversifiedResearchQueue(rows, 8).map((row) => row.id), ["core1", "growth", "larger", "unknown", "core2"]);
  assert.equal(revenueLane(1000), "upper_midmarket");
});
test("larger companies receive valid prior points but do not win solely by revenue", () => {
  const input = { locations: 5, fieldService: true, sectorRank: 0 };
  assert.ok(priorScore({ ...input, revenueUsdM: 900 }) > priorScore({ ...input, revenueUsdM: 1100 }));
  assert.equal(priorScore({ ...input, revenueUsdM: 900 }), priorScore({ ...input, revenueUsdM: 200 }));
});
test("signal sourcing keeps entity boundaries and requires evidence instead of filling quotas", () => {
  const prompt = sourcingPrompt([0], [], [], { day: 4, seeds: [{ company: "Acme", domain: "acme.com", sourceUrl: "https://acme.com/news" }] });
  assert.match(prompt, /\$1B/); assert.match(prompt, /upper_midmarket/); assert.match(prompt, /scoped operating workflow/); assert.match(prompt, /exact targeted entity/); assert.match(prompt, /not facts to repeat without checking/);
});
