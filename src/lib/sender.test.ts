import assert from "node:assert/strict";
import test from "node:test";
import { dedupeParagraphs, similarText, sanitizeSignatureHtml } from "./clean.ts";
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

test("the outbound cleaner removes our own link but never deletes a real word", () => {
  // Our link on its own line (how drafts write it) goes entirely.
  assert.equal(sanitizeLinks("Worth a look?\n\nhttps://nine-67.com"), "Worth a look?");
  // Inline, the sentence is kept. It can leave a slightly clipped "More at." — accepted deliberately: the
  // rule that tidied that up was deleting sentence-initial words from real copy ("See, most ops teams…").
  assert.equal(sanitizeLinks("We build the reporting systems your team needs. More at nine-67.com. Talk soon?"),
    "We build the reporting systems your team needs. More at. Talk soon?");
  // Sentence-initial connectors in ordinary prose must survive untouched.
  assert.equal(sanitizeLinks("We can do that. See, most operations teams already have the data."),
    "We can do that. See, most operations teams already have the data.");
  assert.equal(sanitizeLinks("Here, in plain terms, is what we would build."), "Here, in plain terms, is what we would build.");
  // An email address keeps its domain.
  assert.equal(sanitizeLinks("Reach me at josh@nine-67.com any time."), "Reach me at josh@nine-67.com any time.");
});

test("the outbound cleaner is idempotent and never empties a body", () => {
  const messy = "Nice to meet you. I am founder and CEO of Nine-67.\n\nI saw Netsmart posted for a Data Architect role on your careers page this week.\n\nWant a one-page teardown of how we'd structure it?\n\nhttps://nine-67.com";
  const once = sanitizeLinks(messy);
  assert.equal(sanitizeLinks(once), once);
  assert.ok(!/teardown/i.test(once));
  assert.ok(!/nine-67\.com/i.test(once));
  assert.ok(once.includes("I saw Netsmart posted"));
  // A body that is nothing but the retired CTA must not be blanked.
  assert.ok(sanitizeLinks("Want a one-page teardown of how we'd structure it?").trim().length > 0);
});

test("de-duplication is opt-in, not part of every send", () => {
  // sanitizeLinks no longer de-duplicates: it runs on every outbound body, and a paragraph rule there was
  // deleting real copy. Collapsing a repeated opener is now the explicit "Clean up all drafts" repair.
  const doubled = "Nice to meet you. I am founder and CEO of Nine-67.\n\nNice to meet you. I'm founder and CEO of Nine-67.\n\nWe build reporting systems.";
  assert.equal(sanitizeLinks(doubled).match(/founder and CEO/g)?.length, 2);
  assert.equal(dedupeParagraphs(doubled).match(/founder and CEO/g)?.length, 1);
});

test("only a COSMETIC reword counts as a duplicate — a different claim never does", () => {
  const base = "Nice to meet you. I am founder and CEO of Nine-67.";
  // Cosmetic: case, contraction, punctuation. These are the same sentence typed again.
  for (const variant of [
    "nice to meet you. I am founder and CEO of Nine-67.",
    "Nice to meet you. I'm founder and CEO of Nine-67.",
    "Nice to meet you, I am founder and CEO of Nine-67!",
  ]) {
    assert.equal(similarText(base, variant), true, `should match: ${variant}`);
  }
  // Everything else must be left alone. A looser rule was silently deleting a second proof point, a second
  // value prop, and the company-specific hook — real copy the operator wrote.
  for (const different of [
    "I saw Netsmart posted for a Data Architect and Operations Analyst role this week.",
    "We build automated data and reporting systems that absorb the work those roles would do.",
    "At Mercy we cut onboarding time from six weeks to two weeks.",
    "We help you fill technical roles faster than your internal team can.",
    "Nice to meet you, I am founder and CEO of Nine-67, and I saw the Lead AI role you have had open six weeks.",
  ]) {
    assert.equal(similarText(base, different), false, `should NOT match: ${different}`);
  }
});

test("a pasted HTML signature cannot carry script, handlers or javascript: URLs", () => {
  for (const payload of [
    "<img src=x onerror=alert(1)>",
    "<img src=x/onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    '<a href="javascript:alert(1)">x</a>',
    '<iframe src="javascript:alert(1)"></iframe>',
  ]) {
    const out = sanitizeSignatureHtml(payload);
    assert.ok(!/onerror|onload|javascript:|<script|<iframe|<svg/i.test(out), `still dangerous: ${out}`);
  }
  // A real signature must survive intact.
  const real = '<table><tr><td><a href="https://nine-67.com"><img src="https://cdn.x/logo.png"></a><b>Suuchi</b></td></tr></table>';
  assert.equal(sanitizeSignatureHtml(real), real);
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
