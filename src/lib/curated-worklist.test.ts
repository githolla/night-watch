import test from "node:test";
import assert from "node:assert/strict";
import { curatedDrafts, curatedDomains, isCuratedDomain } from "./curated-worklist.ts";
import { composeContactDraft } from "./contact-draft.ts";
import { emailStyle, emailFirstName } from "./email-style.ts";

test("the active list is exactly25 distinct operating businesses with researched buyers", () => {
  assert.equal(curatedDrafts.length, 25);
  assert.equal(new Set(curatedDomains).size, 25);
  for (const excluded of ["quantiphi.com", "litera.com", "taskus.com", "aprio.com", "hugeinc.com", "codeandtheory.com", "conseroglobal.com"]) assert.equal(isCuratedDomain(excluded), false);
  for (const row of curatedDrafts) {
    assert.ok(row.buyer.name && row.buyer.sourceUrl && row.trigger.sourceUrl, row.company);
    assert.doesNotMatch(row.sector, /consulting|software|agency|IT services/i);
    const draft = composeContactDraft({ company: row.company, domain: row.domain, personName: row.buyer.name, personTitle: row.buyer.title, greeting: "Hello {first},", signoff: "Thanks," });
    assert.equal(draft.subject, row.subject);
    assert.ok(draft.body.includes(row.message), row.company);
    assert.doesNotMatch(draft.subject + draft.body, /[\u2013\u2014]|\bbounded\b|\bleverage\b|instead of (?:a hire|hiring|adding headcount)/i);
  }
  assert.equal(new Set(curatedDrafts.map(row => row.subject)).size, 25);
  assert.equal(new Set(curatedDrafts.map(row => row.message)).size, 25);
});
test("long dashes cannot survive plain text, HTML entities or sender templates", () => {
  assert.equal(emailStyle("First—second &mdash; third &#8212; fourth &#x2014; fifth – sixth"), "First, second, third, fourth, fifth, sixth");
  assert.equal(emailStyle("Nine-67 and supply-chain work"), "Nine-67 and supply-chain work");
  assert.equal(emailFirstName("J. Christopher Hurt"), "Christopher");
  const row = curatedDrafts[0];
  const draft = composeContactDraft({ company: row.company, domain: row.domain, personName: row.buyer.name, personTitle: row.buyer.title, greeting: "Hi {first}—", signoff: "Thanks—Josh" });
  assert.doesNotMatch(draft.body, /[\u2013\u2014]/);
});
