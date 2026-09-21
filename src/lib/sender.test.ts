import assert from "node:assert/strict";
import test from "node:test";
import { dedupeParagraphs, similarText } from "./clean.ts";

test("a re-applied opener is recognised despite case, contraction and wording changes", () => {
  const base = "Nice to meet you. I am founder and CEO of Nine-67.";
  for (const variant of [
    "nice to meet you. I am founder and CEO of Nine-67.",
    "Nice to meet you. I'm founder and CEO of Nine-67.",
    "Nice to meet you. I'm the founder and CEO of Nine-67.",
    "Nice to meet you — I'm founder & CEO of Nine-67!",
    "Nice to meet you. I am founder and CEO at Nine-67.",
  ]) {
    assert.equal(similarText(base, variant), true, `should match: ${variant}`);
  }
  // Genuinely different paragraphs must never be treated as duplicates.
  for (const different of [
    "I saw Netsmart posted for a Data Architect and Operations Analyst role this week.",
    "We build automated data and reporting systems that absorb the work those roles would do.",
    "Would any of these times work for a quick call next week?",
  ]) {
    assert.equal(similarText(base, different), false, `should NOT match: ${different}`);
  }
});

test("a tripled opener collapses to one, leaving the rest of the email intact", () => {
  const body = [
    "Nice to meet you. I am founder and CEO of Nine-67.",
    "nice to meet you. I am founder and CEO of Nine-67.",
    "Nice to meet you. I'm founder and CEO of Nine-67.",
    "I saw Netsmart posted for a Data Architect and Operations Analyst roles on your careers page this week.",
    "We build automated data and reporting systems that absorb the work those roles would do.",
  ].join("\n\n");
  const cleaned = dedupeParagraphs(body);
  assert.equal(cleaned.match(/founder and CEO/g)?.length, 1);
  assert.ok(cleaned.includes("I saw Netsmart posted"));
  assert.ok(cleaned.includes("We build automated data"));
});

test("short repeated lines are left alone (sign-offs, one-liners)", () => {
  const body = "Thank you,\n\nThank you,";
  assert.equal(dedupeParagraphs(body), body);
});
