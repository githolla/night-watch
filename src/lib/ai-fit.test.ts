import assert from "node:assert/strict";
import test from "node:test";
import { AI_FIT_MAX, aiFitScore, priorScore, sectorWeights } from "./ai-fit.ts";

const now = new Date("2026-10-01T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
const url = "https://example.com/source";
const empty = { hiring: [], scale: null, change: [], techOpenness: [], systems: [], disqualifiers: [] };

test("no evidence, no score: the model cannot assert a fit", () => {
  const fit = aiFitScore(empty, { now });
  assert.equal(fit.score, 0);
  assert.equal(fit.summary, "AI fit 0/100");
});

test("hiring counts only roles a system could take on, and only while fresh", () => {
  const fit = aiFitScore({ ...empty, hiring: [
    { title: "Dispatcher", url, postedDate: daysAgo(10) },
    { title: "Estimator", url, postedDate: null },
    { title: "Sales Representative", url, postedDate: daysAgo(5) },
    { title: "Scheduling Coordinator", url, postedDate: daysAgo(200) },
  ] }, { now });
  assert.equal(fit.breakdown.hiring, 12 + 6, "fresh dispatcher full, undated estimator half, sales and stale roles nothing");
  assert.ok(fit.reasons.every((reason) => reason.url));
});

test("scale, change, openness and systems each have a cap, and the total never passes 100", () => {
  const fit = aiFitScore({
    hiring: Array.from({ length: 4 }, () => ({ title: "Billing coordinator", url, postedDate: daysAgo(3) })),
    scale: { locations: 6, fieldWorkforce: 120, highVolume: null, url },
    change: [{ kind: "acquisition", fact: "Acquired a regional competitor in May", date: daysAgo(120), url }, { kind: "leader", fact: "Named a new COO this summer", date: daysAgo(60), url }],
    techOpenness: [{ fact: "CEO told a trade paper they are piloting AI for estimates", date: daysAgo(30), url }, { fact: "Hired a Director of Operations Technology", date: daysAgo(90), url }],
    systems: [{ name: "ServiceTitan", url }, { name: "NetSuite", url }, { name: "Salesforce", url }],
    disqualifiers: [],
  }, { now });
  for (const [criterion, max] of Object.entries(AI_FIT_MAX)) assert.ok(fit.breakdown[criterion as keyof typeof AI_FIT_MAX] <= max, criterion);
  assert.equal(fit.score, 100);
  assert.match(fit.summary, /^AI fit 100\/100: /);
});

test("old news does not count as change", () => {
  const fit = aiFitScore({ ...empty, change: [{ kind: "acquisition", fact: "Acquired a competitor in 2023", date: daysAgo(800), url }] }, { now });
  assert.equal(fit.breakdown.change, 0);
});

test("a disqualifier zeroes the score and says why", () => {
  const fit = aiFitScore({ ...empty, systems: [{ name: "Procore", url }], disqualifiers: ["it is a software company"] }, { now });
  assert.equal(fit.score, 0);
  assert.equal(fit.summary, "Not a fit: it is a software company");
});

test("evidence without an https source is refused outright", () => {
  assert.throws(() => aiFitScore({ ...empty, systems: [{ name: "ServiceTitan", url: "not a link" }] }, { now }));
});

test("the pre-score favours operations-heavy sectors, the $20M to $80M middle, and size hints", () => {
  const best = priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 0 });
  const edge = priorScore({ revenueUsdM: 95, locations: null, fieldService: null, sectorRank: 0 });
  const lowSector = priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 9 });
  assert.ok(best > edge && best > lowSector);
  assert.ok(priorScore({ revenueUsdM: 45, locations: 4, fieldService: true, sectorRank: 0, sectorWeight: 1.5 }) > best, "learned weight lifts a sector");
});

test("sector weights need 20 sends and stay between 0.7 and 1.5", () => {
  const outcomes = [
    ...Array.from({ length: 20 }, (_, index) => ({ sector: "0", positive: index < 16 })),
    ...Array.from({ length: 20 }, (_, index) => ({ sector: "1", positive: index < 1 })),
    ...Array.from({ length: 5 }, () => ({ sector: "2", positive: true })),
  ];
  const weights = sectorWeights(outcomes);
  assert.equal(weights["0"], 1.5);
  assert.equal(weights["1"], 0.7);
  assert.equal(weights["2"], undefined, "too few sends to judge");
});
