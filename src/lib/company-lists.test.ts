import assert from "node:assert/strict";
import test from "node:test";
import { companyStage, summarizeList, type ListCard } from "./company-lists.ts";

const card = (domain: string, extra: Partial<ListCard> = {}): ListCard => ({ domain, status: "new", held: false, sendable: true, positiveReply: false, ...extra });

test("a company counts once, at its furthest step", () => {
  assert.equal(companyStage([card("a.com"), card("a.com", { status: "meeting" })]), "meeting");
  assert.equal(companyStage([card("a.com", { status: "sent", positiveReply: true })]), "positive");
  assert.equal(companyStage([card("a.com", { status: "sent" }), card("a.com")]), "sent");
  assert.equal(companyStage([card("a.com", { status: "approved" })]), "ready");
  assert.equal(companyStage([card("a.com", { status: "approved", held: true })]), "review");
  assert.equal(companyStage([card("a.com", { sendable: false })]), "missing");
  assert.equal(companyStage([card("a.com", { status: "dismissed" })]), "closed");
});

test("a list sums its companies into progress, results, status and the next step", () => {
  const rows = ["a.com", "b.com", "c.com", "d.com", "e.com"].map((domain, index) => ({ domain, sector: index < 3 ? "Pest control" : "Construction" }));
  const cards = [card("a.com", { status: "sent" }), card("b.com", { status: "approved" }), card("c.com"), card("d.com", { sendable: false }), card("E.com", { status: "meeting" })];
  const summary = summarizeList({ date: "2026-10-09", building: false, rows }, cards);
  assert.deepEqual(summary.progress, { sent: 2, ready: 1, review: 1, missing: 1 });
  assert.deepEqual({ companies: summary.companies, positive: summary.positive, meetings: summary.meetings, status: summary.status, next: summary.next }, { companies: 5, positive: 1, meetings: 1, status: "Active", next: "review" });
  assert.deepEqual(summary.sectors, ["Pest control", "Construction"]);
  const building = summarizeList({ date: "2026-10-09", building: true, rows: [] }, []);
  assert.deepEqual([building.status, building.next], ["Preparing", "wait"]);
});
