import test from "node:test";
import assert from "node:assert/strict";
import { curatedDrafts } from "./curated-worklist.ts";
import { sortReachouts, revenueLabel, reachoutPool, defaultReachoutSort, fitScore, revenueYearLabel, sendStateLabel } from "./reachout-sort.ts";
import { setNightlyLists, type ListRow } from "./research-data/server.ts";

const cards = curatedDrafts().map(row => ({ accounts: { name: row.company, domain: row.domain }, people: { email_status: "unverified" } }));
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

test("the selected list retains all 25 companies when only two drafts remain open", () => {
  const mixed = cards.map((card, i) => ({ ...card, status: i < 2 ? "new" : "sent" }));
  const before = JSON.stringify(mixed);
  const open = mixed.filter(card => card.status === "new");
  assert.equal(open.length, 2);
  const pool = reachoutPool(mixed, open);
  assert.equal(new Set(pool.map(card => card.accounts.domain)).size, 25);
  assert.equal(pool.filter(card => card.status === "sent").length, 23);
  assert.equal(JSON.stringify(mixed), before);
  assert.equal(sortReachouts(pool, "revenue-desc")[0].accounts.name, "Ansara Restaurant Group");
});

const nightlyRow = (domain: string, company: string, rank: number | null, score: number | null, extra: Record<string, unknown> = {}) => ({
  domain, company, assignedOwner: "josh", contacts: [], revenue: { usdMillions: 40, year: 2024, status: "reported", sourceUrl: "https://example.test" },
  ...(rank === null ? {} : { rank }), ...(score === null ? {} : { aiFit: { score, disqualified: null, reasons: [] } }), ...extra,
}) as unknown as ListRow;
function withNightly(rows: ListRow[], run: () => void) {
  setNightlyLists({ nightlyFocus: rows, nightlyOffers: [], nightlyLatest: { josh: rows.map(row => row.domain), suuchi: [] } });
  try { run(); } finally { setNightlyLists({ nightlyFocus: [], nightlyOffers: [], nightlyLatest: { josh: [], suuchi: [] } }); }
}
const card = (domain: string, name: string) => ({ accounts: { name, domain }, people: { email_status: "unverified" } });

test("Today's list sorts by list rank, then fit, with missing values last by name", () => {
  withNightly([
    nightlyRow("third.test", "Third", 3, 90),
    nightlyRow("first.test", "First", 1, 50),
    nightlyRow("second.test", "Second", 2, 99),
    nightlyRow("fit-high.test", "Zeta Unranked", null, 80),
    nightlyRow("fit-low.test", "Alpha Unranked", null, 45),
    nightlyRow("bare-b.test", "Bare B", null, null),
    nightlyRow("bare-a.test", "Bare A", null, null),
  ], () => {
    const sorted = sortReachouts([card("bare-b.test", "Bare B"), card("fit-low.test", "Alpha Unranked"), card("third.test", "Third"), card("bare-a.test", "Bare A"), card("fit-high.test", "Zeta Unranked"), card("second.test", "Second"), card("first.test", "First")], "list-order");
    assert.deepEqual(sorted.map(item => item.accounts.name), ["First", "Second", "Third", "Zeta Unranked", "Alpha Unranked", "Bare A", "Bare B"]);
    assert.equal(fitScore("second.test"), 99);
    assert.equal(fitScore("bare-a.test"), null);
  });
});

test("list order is the default only for Today's list", () => {
  assert.equal(defaultReachoutSort(3), "list-order");
  assert.equal(defaultReachoutSort(1), "revenue-desc");
  assert.equal(defaultReachoutSort(2), "revenue-desc");
  assert.equal(defaultReachoutSort(undefined), "revenue-desc");
});

test("the revenue year comes from the row and says when it is unconfirmed", () => {
  withNightly([
    nightlyRow("reported.test", "Reported", 1, 60),
    nightlyRow("unsure.test", "Unsure", 2, 60, { revenue: { usdMillions: 30, year: 2023, status: "unconfirmed", sourceUrl: "https://example.test" } }),
  ], () => {
    assert.equal(revenueYearLabel("reported.test"), "2024");
    assert.equal(revenueYearLabel("unsure.test"), "2023 · unconfirmed");
    assert.equal(revenueYearLabel("nowhere.test"), null);
  });
});

test("send-state chip covers every state and never claims more than a prediction", () => {
  const deliverable = { emailCheck: { level: "deliverable", reason: "Hunter verified this address." } };
  const risky = { emailCheck: { level: "risky", reason: "Not confirmed by Hunter." } };
  const window = { sendFrom: 9 * 60, sendUntil: 11 * 60 + 30, timeZone: "America/New_York" };
  assert.deepEqual(sendStateLabel({ status: "sent" }, deliverable, null, "2026-10-01T13:20:00Z", window), { kind: "sent", label: "Sent 9:20" });
  assert.deepEqual(sendStateLabel({ status: "sent" }, deliverable, null, null, window), { kind: "sent", label: "Sent" });
  assert.deepEqual(sendStateLabel({ status: "new" }, deliverable, "auto-send is off", null, window), { kind: "blocked", label: "Auto-send is off" });
  assert.deepEqual(sendStateLabel({ status: "new" }, deliverable, "auto-send is paused", null, window), { kind: "blocked", label: "Auto-send is paused" });
  assert.deepEqual(sendStateLabel({ status: "new", auto_send_hold: true }, deliverable, null, null, window), { kind: "kept", label: "Kept for you" });
  assert.deepEqual(sendStateLabel({ status: "edited" }, deliverable, null, null, window), { kind: "auto", label: "Auto 9:00 to 11:30 (expected)" });
  assert.deepEqual(sendStateLabel({ status: "new" }, risky, null, null, window), { kind: "manual", label: "Needs a hand send: address not confirmed" });
  assert.deepEqual(sendStateLabel({ status: "new" }, { ...deliverable, identityHold: "the buyer's title is not confirmed" }, null, null, window), { kind: "manual", label: "Needs a hand send: the buyer's title is not confirmed" });
  assert.deepEqual(sendStateLabel({ status: "new" }, undefined, null, null, window), { kind: "manual", label: "Needs a hand send: address not confirmed" });
});
