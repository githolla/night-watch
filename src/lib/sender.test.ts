import assert from "node:assert/strict";
import test from "node:test";
import { dedupeParagraphs, similarText } from "./clean.ts";
import { sanitizeLinks } from "./sender.ts";

test("the outbound cleaner never mangles a prospect's own words", () => {
  // Deleting the prospect's domain used to leave "I saw the roles on this week."
  const hook = "I saw the roles on netsmart.com/careers this week. Worth a look?";
  assert.equal(sanitizeLinks(hook), hook);
  // Abbreviations and company suffixes must survive the domain stripper.
  const abbrev = "We work with U.S. teams, e.g. ops and finance, at Acme Inc. today.";
  assert.equal(sanitizeLinks(abbrev), abbrev);
  // Two genuinely different paragraphs must both survive the de-duplicator.
  const distinct = "We build automated data pipelines that run the reporting.\n\nWe also run the analysis your finance team needs each week.";
  assert.equal(sanitizeLinks(distinct), distinct);
});

test("the outbound cleaner removes our own link without leaving broken prose", () => {
  // Our link on its own line (how drafts write it) goes entirely.
  assert.equal(sanitizeLinks("Worth a look?\n\nhttps://nine-67.com"), "Worth a look?");
  // Inline, the surrounding sentence is kept and the dangling connector cleaned up.
  assert.equal(sanitizeLinks("We build the reporting systems your team needs. More at nine-67.com. Talk soon?"),
    "We build the reporting systems your team needs. Talk soon?");
  assert.equal(sanitizeLinks("You can read more at https://nine-67.com here."), "You can read more here.");
});

test("the outbound cleaner is idempotent (clean-drafts is safe to run twice)", () => {
  const messy = "Nice to meet you. I am founder and CEO of Nine-67.\n\nNice to meet you. I'm founder and CEO of Nine-67.\n\nI saw Netsmart posted for a Data Architect role on your careers page this week.\n\nWant a one-page teardown of how we'd structure it?\n\nhttps://nine-67.com";
  const once = sanitizeLinks(messy);
  assert.equal(sanitizeLinks(once), once);
  assert.equal(once.match(/founder and CEO/g)?.length, 1);
  assert.ok(!/teardown/i.test(once));
  assert.ok(!/nine-67\.com/i.test(once));
  assert.ok(once.includes("I saw Netsmart posted"));
});

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
