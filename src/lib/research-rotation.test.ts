import assert from "node:assert/strict";
import test from "node:test";
import { nightsForFullPass, orderForResearch, priorityBand, selectResearchBatch } from "./research-rotation.ts";

const DAY = 24 * 3600_000;
const now = Date.parse("2026-09-10T06:00:00Z");

function fixture(total: number, scoutedYesterday: number) {
  return Array.from({ length: total }, (_, index) => ({
    domain: `company-${String(index).padStart(3, "0")}.example.com`,
    name: `Company ${String(index).padStart(3, "0")}`,
    last_scouted_at: index < scoutedYesterday ? new Date(now - DAY).toISOString() : null,
  }));
}

test("a batch never contains a company researched yesterday", () => {
  const accounts = fixture(100, 10);
  const batch = selectResearchBatch(accounts, { limit: 10, cooldownMs: 7 * DAY, now });
  assert.equal(batch.length, 10);
  assert.ok(batch.every((account) => account.last_scouted_at === null));
});

test("three consecutive nights select three disjoint batches", () => {
  const accounts = fixture(100, 0);
  const seen = new Set<string>();
  let clock = now;
  for (let night = 0; night < 3; night += 1) {
    const batch = selectResearchBatch(accounts, { limit: 10, cooldownMs: 7 * DAY, now: clock });
    assert.equal(batch.length, 10);
    for (const account of batch) {
      assert.ok(!seen.has(account.domain), `${account.domain} was selected twice`);
      seen.add(account.domain);
      account.last_scouted_at = new Date(clock).toISOString();
    }
    clock += DAY;
  }
  assert.equal(seen.size, 30);
});

test("never-researched companies outrank recently checked ones regardless of band", () => {
  const accounts = [
    { domain: "hot.example.com", name: "Hot", last_scouted_at: new Date(now - 10 * DAY).toISOString(), band: 2 },
    { domain: "cold.example.com", name: "Cold", last_scouted_at: null, band: 0 },
  ];
  const ordered = orderForResearch(accounts, (account) => account.band);
  assert.deepEqual(ordered.map((account) => account.domain), ["cold.example.com", "hot.example.com"]);
});

test("band and name break ties among never-researched companies", () => {
  const accounts = [
    { domain: "b.example.com", name: "Beta", last_scouted_at: null, band: 0 },
    { domain: "a.example.com", name: "Alpha", last_scouted_at: null, band: 0 },
    { domain: "z.example.com", name: "Zulu", last_scouted_at: null, band: 2 },
  ];
  const ordered = orderForResearch(accounts, (account) => account.band);
  assert.deepEqual(ordered.map((account) => account.name), ["Zulu", "Alpha", "Beta"]);
});

test("among researched companies the oldest research comes first", () => {
  const accounts = [
    { domain: "recent.example.com", name: "Recent", last_scouted_at: new Date(now - 8 * DAY).toISOString() },
    { domain: "old.example.com", name: "Old", last_scouted_at: new Date(now - 30 * DAY).toISOString() },
  ];
  const batch = selectResearchBatch(accounts, { limit: 1, cooldownMs: 7 * DAY, now });
  assert.equal(batch[0].domain, "old.example.com");
});

test("priority band is coarse", () => {
  assert.equal(priorityBand({ aiSignal: "Hiring an AI lead", ceo: "", ownership: "Public" }), 2);
  assert.equal(priorityBand({ aiSignal: "", ceo: "Jane Doe", ownership: "Private" }), 1);
  assert.equal(priorityBand({ aiSignal: "", ceo: "", ownership: "PE-backed" }), 1);
  assert.equal(priorityBand({ aiSignal: "", ceo: "", ownership: "Private" }), 0);
  assert.equal(priorityBand(null), 0);
});

test("a full pass over 1,859 companies at 10 a night takes 186 nights", () => {
  assert.equal(nightsForFullPass(1859, 10), 186);
  assert.equal(nightsForFullPass(1859, 50), 38);
});
