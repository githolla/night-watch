import assert from "node:assert/strict";
import test from "node:test";
import { SECTORS } from "./list-sectors.ts";
import {
  canStartBatch, committedSpend, DELIVERABLE_BONUS, failureReason, finalizeAtUtc, LIMIT_FAILURE, MAX_SOURCING_ATTEMPTS, minedHosts, nextSourcingAction, normalizeCompanyName,
  pastFinalizeDeadline, rankForList, reclaimStatus, sectorKeyFor, shouldRequeue, slotsWithinBudget, sourcingAttempts, sourcingPrompt,
} from "./nightly-list-rules.ts";

const base = { queueLength: 0, slots: 3, sourcedThisRun: true, sourcingAdded: 0, sourcingFailed: true, sourcingAttempts: 1, pastDeadline: false };

test("a failed or empty sourcing call leaves the lists open for the next run", () => {
  assert.equal(nextSourcingAction(base), "stop-and-retry");
  assert.equal(nextSourcingAction({ ...base, sourcingFailed: false, sourcingAdded: 0 }), "stop-and-retry");
});

test("the night closes at the attempt cap or past the deadline", () => {
  assert.equal(nextSourcingAction({ ...base, sourcingAttempts: MAX_SOURCING_ATTEMPTS }), "finalize");
  assert.equal(nextSourcingAction({ ...base, pastDeadline: true }), "finalize");
});

test("a queue with companies is researched", () => {
  assert.equal(nextSourcingAction({ ...base, queueLength: 2 }), "research");
  assert.equal(nextSourcingAction({ ...base, queueLength: 5, sourcedThisRun: false }), "research", "a full queue needs no sourcing");
});

test("sourcing runs once per invocation, and again only after a call that added rows", () => {
  assert.equal(nextSourcingAction({ ...base, sourcedThisRun: false, sourcingAttempts: 0 }), "source");
  assert.equal(nextSourcingAction({ ...base, sourcingAdded: 4, sourcingFailed: false, queueLength: 1 }), "source");
  assert.equal(nextSourcingAction({ ...base, sourcedThisRun: false, sourcingAttempts: MAX_SOURCING_ATTEMPTS, queueLength: 1 }), "research");
});

test("sourcing attempts are counted from the list errors", () => {
  assert.equal(sourcingAttempts([{ kind: "sourcing", reason: "x" }, { domain: "a.com", reason: "y" }, null, "z", { kind: "sourcing", reason: "w" }]), 2);
});

test("no batch or sourcing call starts after the cutoff", () => {
  assert.equal(canStartBatch(179_999), true);
  assert.equal(canStartBatch(180_000), false);
  assert.equal(canStartBatch(50, 40), false);
});

test("the finalize deadline is a UTC time, 09:40 unless configured", () => {
  assert.equal(finalizeAtUtc(undefined), 580);
  assert.equal(finalizeAtUtc("9:15"), 555);
  assert.equal(finalizeAtUtc("nonsense"), 580);
  assert.equal(pastFinalizeDeadline(new Date("2026-10-01T09:39:00Z")), false);
  assert.equal(pastFinalizeDeadline(new Date("2026-10-01T09:40:00Z")), true);
});

test("committed spend counts companies still being researched at the cap", () => {
  assert.equal(committedSpend(2, 3, 0.5), 3.5);
  assert.equal(slotsWithinBudget(10, 10 - 0.6, 0.5), 1, "60 cents left pays for one company at most");
  assert.equal(slotsWithinBudget(10, 9.6, 0.5), 0);
  assert.equal(slotsWithinBudget(10, 9.5, 0.5), 1, "exactly one cap left");
  assert.equal(slotsWithinBudget(10, 11, 0.5), 0);
});

test("a company cut off twice is skipped instead of requeued", () => {
  assert.deepEqual(reclaimStatus(1), { status: "new" });
  assert.deepEqual(reclaimStatus(2), { status: "skipped", skipReason: "timed out twice" });
});

test("spend and search cap failures get their own marker", () => {
  assert.equal(failureReason("research failed: Stopped at this company's $0.50 research cap ($0.51 spent)."), `${LIMIT_FAILURE}: Stopped at this company's $0.50 research cap ($0.51 spent).`);
  assert.match(failureReason("research failed: This company's paid web searches are used up."), /^research failed \(limit\)/);
  assert.equal(failureReason("research failed: 529 overloaded"), "research failed: 529 overloaded");
  assert.equal(failureReason("AI fit 30 is below 40"), "AI fit 30 is below 40");
});

test("only transient failures and near-miss fits are requeued, once, after 30 days", () => {
  const now = new Date("2026-10-01T06:00:00Z");
  const old = "2026-08-15T06:00:00Z", recent = "2026-09-20T06:00:00Z";
  const requeue = (skipReason: string, extra: Partial<Parameters<typeof shouldRequeue>[0]> = {}) => shouldRequeue({ skipReason, researchedAt: old, retryCount: 0, minFit: 40, now, ...extra });
  assert.equal(requeue("research failed: 529 overloaded"), true);
  assert.equal(requeue("research failed (limit): This company's paid web searches are used up."), false);
  assert.equal(requeue("AI fit 30 is below 40"), true);
  assert.equal(requeue("AI fit 29 is below 40"), false);
  for (const reason of ["rejected: consulting firm", "revenue $140M is outside $10M to $100M", "excluded sector", "not an AI fit: software_or_it", "\"Info Team\" is not a person's name", "timed out twice"]) assert.equal(requeue(reason), false, reason);
  assert.equal(requeue("research failed: 529", { researchedAt: recent }), false, "too soon");
  assert.equal(requeue("research failed: 529", { retryCount: 1 }), false, "already retried");
  assert.equal(requeue("research failed: 529", { researchedAt: null }), false);
});

test("names are compared after dropping case, punctuation and legal suffixes", () => {
  assert.equal(normalizeCompanyName("Acme Landscaping, LLC"), "acme landscaping");
  assert.equal(normalizeCompanyName("acme landscaping"), "acme landscaping");
  assert.equal(normalizeCompanyName("The Acme Co."), "acme");
  assert.equal(normalizeCompanyName("A.B.C. Supply Co., Inc."), "a b c supply");
  assert.notEqual(normalizeCompanyName("Acme Landscaping Group"), "acme landscaping", "exact match only, not token overlap");
});

test("an invalid sector number gives no sector key", () => {
  assert.equal(sectorKeyFor(42), null);
  assert.equal(sectorKeyFor(-1), null);
  assert.equal(sectorKeyFor(null), null);
  assert.equal(sectorKeyFor(2), 2);
  assert.equal(sectorKeyFor(SECTORS.length - 1), SECTORS.length - 1);
});

test("the sourcing prompt names tonight's sectors' domains and the rankings already used", () => {
  const prompt = sourcingPrompt([2, 5], ["greenco.com", "treeco.com"], minedHosts(["https://www.landscapemanagement.net/lm150", "https://landscapemanagement.net/lm150?page=2", null, "not a url"]));
  assert.match(prompt, /2\. landscape construction/);
  assert.match(prompt, /do not repeat these domains: greenco\.com, treeco\.com/);
  assert.match(prompt, /Rankings already used: landscapemanagement\.net\. Use a different ranking, or the positions after those already used/);
  assert.doesNotMatch(sourcingPrompt([2, 5], [], []), /Already found|Rankings already used/);
});

const row = (fit: number, level: string, identityHold: string | null = null) => ({ domain: `${fit}-${level}`, aiFit: { score: fit }, emailCheck: { level }, identityHold });

test("a deliverable row within 8 fit points outranks a risky one while auto-send is live", () => {
  const ranked = rankForList([row(70, "risky"), row(70 - DELIVERABLE_BONUS + 1, "deliverable")], true);
  assert.equal(ranked[0].emailCheck.level, "deliverable");
});

test("a risky row 20 points higher stays ahead", () => {
  const ranked = rankForList([row(60, "deliverable"), row(80, "risky")], true);
  assert.equal(ranked[0].aiFit.score, 80);
});

test("a held deliverable address gets no lift", () => {
  const ranked = rankForList([row(70, "risky"), row(66, "deliverable", "the buyer's only source is old")], true);
  assert.equal(ranked[0].aiFit.score, 70);
});

test("nothing is reordered for deliverability when auto-send is off", () => {
  const rows = [row(64, "deliverable"), row(70, "risky"), row(66, "deliverable")];
  assert.deepEqual(rankForList(rows, false).map((item) => item.aiFit.score), [70, 66, 64]);
});
