import test from "node:test";
import assert from "node:assert/strict";
import { curatedDrafts } from "./curated-worklist.ts";
import { sortReachouts, revenueLabel } from "./reachout-sort.ts";

const cards = curatedDrafts.map(row => ({ accounts: { name: row.company, domain: row.domain }, people: { email_status: "unverified" } }));
test("revenue sorting uses numeric revenue, not fit score or publication status", () => {
  const original = JSON.stringify(cards);
  const descending = sortReachouts(cards, "revenue-desc");
  assert.equal(descending[0].accounts.name, "Ansara Restaurant Group");
  assert.equal(descending[1].accounts.name, "Metro Wire & Cable");
  assert.equal(descending.at(-1)?.accounts.name, "Native Pest Management");
  assert.equal(sortReachouts(cards, "revenue-asc")[0].accounts.name, "Native Pest Management");
  assert.equal(JSON.stringify(cards), original);
  assert.equal(revenueLabel("www.metrowire.net"), "$93.2M");
});
test("name and verification sorts are selectable; published emails do not count as verified", () => {
  assert.equal(sortReachouts(cards, "name")[0].accounts.name, "Almetals / Chain Industries");
  const native = cards.find(card => card.accounts.domain === "nativepestmanagement.com")!;
  const verified = cards.map(card => card === native ? { ...card, people: { email_status: "verified" } } : card);
  assert.equal(sortReachouts(verified, "verified")[0].accounts.name, "Native Pest Management");
  assert.equal(sortReachouts(verified, "revenue-desc")[0].accounts.name, "Ansara Restaurant Group");
  const missing = { accounts: { name: "Unknown", domain: "unknown.test" }, people: { email_status: "none" } };
  assert.equal(sortReachouts([missing, ...cards], "revenue-asc").at(-1)?.accounts.name, "Unknown");
});
