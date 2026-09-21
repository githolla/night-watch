import assert from "node:assert/strict";
import test from "node:test";
import { dedupeParagraphs, similarText, sanitizeSignatureHtml, hasProposedTimes, stripProposedTimes, decodeEntities, foreignEmployer, greetedName, stripLeadingGreeting, isRoleAddress, looksLikeDocumentName, isRealContact } from "./clean.ts";
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

test("proposed meeting times can be taken back out of a draft", () => {
  const written = "Hi Robert,\n\nSaw the Data Architect role you've had open six weeks. We'd build the pipeline instead.\n\nWorth a look?\n\nThank you,";
  const withTimes = `${written}\n\nWould any of these work for a quick call?\n• Tue 23 Sep, 10:00 AM ET\n• Wed 24 Sep, 2:00 PM ET\n\nHappy to send a calendar invite for whichever suits.`;

  assert.equal(hasProposedTimes(written), false);
  assert.equal(hasProposedTimes(withTimes), true);
  // Removing the block must give back exactly what the operator wrote, not an approximation.
  assert.equal(stripProposedTimes(withTimes), written);
  // Clicking "Propose times" twice inserted it twice; both come out.
  assert.equal(stripProposedTimes(`${withTimes}\n\nWould any of these work for a quick call?\n• Thu 25 Sep, 9:00 AM ET\n\nHappy to send a calendar invite for whichever suits.`), written);
  // The operator may have deleted the trailing sentence before changing their mind.
  assert.equal(stripProposedTimes(`${written}\n\nWould any of these work for a quick call?\n• Tue 23 Sep, 10:00 AM ET`), written);
  // A draft with no times is returned untouched, and stripping is safe to repeat.
  assert.equal(stripProposedTimes(written), written);
  assert.equal(stripProposedTimes(stripProposedTimes(withTimes)), written);
});

test("HTML entities in scraped names and titles are decoded", () => {
  assert.equal(decodeEntities("Employers&#27; Forum of Indiana"), "Employers' Forum of Indiana");
  assert.equal(decodeEntities("Johnson &amp; Johnson"), "Johnson & Johnson");
  assert.equal(decodeEntities("O&#x27;Brien"), "O'Brien");
  assert.equal(decodeEntities("Sales &amp; Marketing &mdash; EMEA"), "Sales & Marketing — EMEA");
  assert.equal(decodeEntities("Chief Operating Officer"), "Chief Operating Officer");
});

test("a contact who works somewhere else is spotted, and a real title is never mistaken for one", () => {
  // Executives quoted on a page about another company were being stored as that company's contacts.
  assert.equal(foreignEmployer("CIO, Peterson Cheese", "Quantiphi", "quantiphi.com"), "Peterson Cheese");
  assert.equal(foreignEmployer("President &amp; CEO, Employers&#27; Forum of Indiana", "Quantiphi", "quantiphi.com"), "Employers' Forum of Indiana");

  // Everything below is a REAL title at the company and must survive. Wrongly hiding a decision-maker
  // costs more than leaving one bad row on screen, so anything uncertain must return null.
  for (const title of [
    "Chief Operating Officer",
    "COO / CFO",
    "Co-Founder",
    "VP - Marketing",
    "VP, Marketing",
    "VP, Corporate Development",
    "VP, Finance Transformation & Advisory Services",
    "EVP, Head of E&S Casualty",
    "SVP, Global Operations",
    "Director, Information Technology",
    "Head of Data",
    "Chief Information Security Officer",
    "VP, People",
    "Senior Director, Supply Chain",
    "Managing Director, Client Success",
  ]) {
    assert.equal(foreignEmployer(title, "Quantiphi", "quantiphi.com"), null, `should NOT flag: ${title}`);
  }

  // The same company written differently is not a foreign employer.
  assert.equal(foreignEmployer("CEO, Quantiphi", "Quantiphi", "quantiphi.com"), null);
  assert.equal(foreignEmployer("CEO, Quantiphi Inc", "Quantiphi", "quantiphi.com"), null);
  assert.equal(foreignEmployer("CTO, Consero Global", "Consero Global", "conseroglobal.com"), null);
  // No comma at all, nothing to judge.
  assert.equal(foreignEmployer("Chief Executive Officer", "Quantiphi"), null);
  assert.equal(foreignEmployer("", "Quantiphi"), null);
});

test("an employer named with \"at\" is caught too, without eating a real title", () => {
  assert.equal(foreignEmployer("VP of Application Development and Platform Engineering at TalentNet", "Quantiphi", "quantiphi.com"), "TalentNet");
  assert.equal(foreignEmployer("CTO at Peterson Cheese", "Quantiphi", "quantiphi.com"), "Peterson Cheese");
  // Same company, however it is written.
  assert.equal(foreignEmployer("VP of Engineering at Quantiphi", "Quantiphi", "quantiphi.com"), null);
  // A single ordinary word after "at" is part of the role, not an employer.
  assert.equal(foreignEmployer("Head of Data at Scale", "Quantiphi", "quantiphi.com"), null);
  assert.equal(foreignEmployer("Director of Engineering at Large", "Quantiphi", "quantiphi.com"), null);
  // Departments after "at" are not employers either.
  assert.equal(foreignEmployer("Senior Director at Global Operations", "Quantiphi", "quantiphi.com"), null);
});

test("a greeting is found whether it ends the line or runs into the first sentence", () => {
  // What the writing model actually produces — greeting inline. This shape matched nothing before, so the
  // message kept "Hi Asif," inside it while the Greeting field showed whoever was selected.
  assert.equal(greetedName("Hi Asif, Nice to meet you. I am founder and CEO of Nine-67."), "Asif");
  assert.equal(stripLeadingGreeting("Hi Asif, Nice to meet you. I am founder and CEO of Nine-67."),
    "Nice to meet you. I am founder and CEO of Nine-67.");

  // The on-its-own-line shape must keep working.
  assert.equal(greetedName("Hi Robert,\n\nSaw the Data Architect role."), "Robert");
  assert.equal(stripLeadingGreeting("Hi Robert,\n\nSaw the Data Architect role."), "Saw the Data Architect role.");

  // Other shapes drafts use.
  assert.equal(greetedName("Hello Ms. Chen: we build"), "Ms. Chen");
  assert.equal(greetedName("Hey Jim!\nQuick idea"), "Jim");
  assert.equal(greetedName("Dear Reghu Hariharan,\n\nOne thought"), "Reghu Hariharan");

  // No greeting: the body is returned untouched and nothing is invented.
  assert.equal(greetedName("Quantiphi is hiring 6 senior data engineering roles."), null);
  assert.equal(stripLeadingGreeting("Quantiphi is hiring 6 senior data engineering roles."),
    "Quantiphi is hiring 6 senior data engineering roles.");
  // A real sentence that merely starts with a greeting word must not lose its opening.
  assert.equal(stripLeadingGreeting("Higher throughput is the point here."), "Higher throughput is the point here.");
});

test("a functional mailbox is never treated as a person", () => {
  for (const email of [
    "recruiting@quantiphi.com", "careers@acme.com", "jobs@acme.com", "hr@acme.com",
    "service@acme.com", "support@acme.com", "info@acme.com", "hello@acme.com",
    "sales@acme.com", "marketing@acme.com", "press@acme.com", "legal@acme.com",
    "billing@acme.com", "accounts@acme.com", "noreply@acme.com", "no-reply@acme.com",
    "team@acme.com", "the-team@acme.com", "info.uk@acme.com", "contact@acme.com",
    "partnerships@acme.com", "investors@acme.com", "talent@acme.com",
  ]) {
    assert.equal(isRoleAddress(email), true, `should be a role mailbox: ${email}`);
  }
  // Real people must not be caught, including ones whose names collide with role words.
  for (const email of [
    "asif.hasan@quantiphi.com", "jim.reesing@quantiphi.com", "bridget.howard@conseroglobal.com",
    "j.smith@acme.com", "msales@acme.com", "salesforce.chen@acme.com", "arthur@acme.com",
    "irene@acme.com", "prakash@acme.com", "hrithik.roshan@acme.com", "ito@acme.com",
  ]) {
    assert.equal(isRoleAddress(email), false, `should be a person: ${email}`);
  }
  assert.equal(isRoleAddress(null), false);
  assert.equal(isRoleAddress(""), false);
});

test("a page title scraped as a contact is rejected", () => {
  for (const name of [
    "Modern Slavery Statement", "Privacy Policy", "Terms and Conditions", "Annual Report",
    "Cookie Notice", "Launch Partner", "Press Release", "Case Study",
  ]) {
    assert.equal(looksLikeDocumentName(name), true, `should be rejected: ${name}`);
  }
  for (const name of ["Asif Hasan", "Jim Reesing", "Bridget Howard", "Reghu Hariharan", "Ashley Honeyman"]) {
    assert.equal(looksLikeDocumentName(name), false, `should be kept: ${name}`);
  }
});

test("isRealContact combines both, and keeps real people", () => {
  assert.equal(isRealContact({ full_name: "Modern Slavery Statement", email: "modern.statement@quantiphi.com" }), false);
  assert.equal(isRealContact({ full_name: "Talent Acquisition", email: "recruiting@quantiphi.com" }), false);
  assert.equal(isRealContact({ full_name: "Asif Hasan", email: "recruiting@quantiphi.com" }), false);
  assert.equal(isRealContact({ full_name: "Asif Hasan", email: "asif.hasan@quantiphi.com" }), true);
  assert.equal(isRealContact({ full_name: "Bridget Howard", email: null }), true);
});
