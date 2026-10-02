import test from "node:test";
import assert from "node:assert/strict";
import { bucketSkips, fitRange, listReport, nightSpend, skipBucket, skipEntries } from "./list-build-report.ts";

test("every skip reason the nightly builder writes lands in a named bucket", () => {
  const reasons: Array<[string, string]> = [
    ["rejected: the company is a staffing firm", "rejected"],
    ["revenue $140M is outside $10M to $100M", "revenue out of range"],
    ['"Leadership Team" is not a person\'s name', "no named buyer"],
    ["excluded sector", "excluded sector"],
    ["not an AI fit: software_or_it", "not an AI fit"],
    ["AI fit 31 is below 40", "low fit"],
    ["workflow task is missing", "copy failed"],
    ["workflow subject is longer than five words", "copy failed"],
    ["workflow inputs has a question mark, a long dash or a link", "copy failed"],
    ["repair failed: timeout", "copy failed"],
    ["repair did not return a workflow", "copy failed"],
    ["copy failed checks: direct-offer: too long", "copy failed"],
    ["example.com does not accept email", "email or verify"],
    ["no deliverable address for the buyer", "email or verify"],
    ["research failed: 529 overloaded", "research failed"],
    ["buyer source was not seen in the search results", "buyer source not seen"],
    ["could not prepare the card: timeout", "prepare"],
    ["sourcing failed: no companies returned", "sourcing"],
  ];
  for (const [reason, bucket] of reasons) assert.equal(skipBucket(reason), bucket, reason);
  assert.equal(skipBucket("rejected: an outsourcing provider"), "rejected");
  assert.equal(skipBucket("something new"), "other");
});

test("skips are counted by bucket, largest first, and the raw list keeps the last 50", () => {
  const errors = [
    ...Array.from({ length: 4 }, (_, index) => ({ domain: `low${index}.test`, reason: "AI fit 20 is below 40" })),
    { domain: "a.test", reason: '"Team" is not a person\'s name' },
    { domain: "b.test", reason: '"Staff" is not a person\'s name' },
    { domain: "c.test", reason: "excluded sector" },
    "sourcing failed: empty",
    null, { domain: "x.test" },
  ];
  assert.deepEqual(bucketSkips(errors), [{ bucket: "low fit", count: 4 }, { bucket: "no named buyer", count: 2 }, { bucket: "excluded sector", count: 1 }, { bucket: "sourcing", count: 1 }]);
  assert.equal(skipEntries(errors).length, 8);
  const many = Array.from({ length: 70 }, (_, index) => ({ domain: `d${index}.test`, reason: "excluded sector" }));
  const report = listReport({ status: "ready", rows: [], attempts: 20, errors: many, announced_at: null, sent_count: 0, held_count: 0 }, 20);
  assert.equal(report.skips.length, 50);
  assert.equal(report.skips[0].domain, "d20.test");
});

test("fit range reads aiFit scores and ignores rows without one", () => {
  assert.deepEqual(fitRange([{ aiFit: { score: 88 } }, { aiFit: { score: 52 } }, { aiFit: { score: 70 } }, { company: "old row" }]), { min: 52, median: 70, max: 88 });
  assert.deepEqual(fitRange([{ aiFit: { score: 50 } }, { aiFit: { score: 61 } }]), { min: 50, median: 56, max: 61 });
  assert.equal(fitRange([{ company: "old" }]), null);
  assert.equal(fitRange(null), null);
});

test("the night's spend is one total across both seats", () => {
  assert.deepEqual(nightSpend([{ cost_usd: 4.2 }, { cost_usd: "2.2" }, { cost_usd: null }], 10), { costUsd: 6.4, budgetUsd: 10 });
});
