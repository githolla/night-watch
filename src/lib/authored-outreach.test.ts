import { isCuratedDomain } from "./curated-worklist.ts";
import test from "node:test";
import assert from "node:assert/strict";
import rows from "../../data/customized-emails.json" with { type: "json" };
import { authoredCompany, authoredDraft } from "./authored-outreach.ts";
import { composeContactDraft } from "./contact-draft.ts";
import { auditDraft } from "./draft-audit.ts";

test("domain matching never confuses companies with similar names", () => {
  assert.equal(authoredCompany("Trinity Life Sciences", "trinitylifesciences.com")?.company, "Trinity Life Sciences");
  assert.notEqual(authoredCompany("Trinity Life Sciences", "trinityconsultants.com")?.company, "Trinity Life Sciences");
  assert.equal(authoredCompany("Aprio", "unrelated.example"), undefined);
  assert.equal(authoredCompany("anything", "https://www.aprio.com/path")?.company, "Aprio");
});
test("all443 reviewed drafts are reachable for their intended buyer and pass sending safeguards", () => {
  for (const row of rows) {
    const reviewed = authoredDraft(row.company, row.targetRole, row.domain);
    assert.equal(reviewed?.subject, row.subject, row.company);
    const draft = composeContactDraft({ company: row.company, domain: row.domain, personName: "Alex Morgan", personTitle: row.targetRole, greeting: "Hello {first},", signoff: "Best," });
    assert.ok(draft.body.startsWith("Hello Alex,"));
    assert.ok(isCuratedDomain(row.domain) ? draft.body.endsWith("?") : draft.body.endsWith("Best,"));
    assert.doesNotMatch(draft.body, /I am .*at Nine-67/);
    const faults = auditDraft({ id: String(row.id), status: "new", subject: draft.subject, body: draft.body, personName: "Alex Morgan", personTitle: row.targetRole, personEmail: "alex@example.com", company: row.company }).filter(fault => fault.blocking);
    assert.deepEqual(faults, [], `${row.company}: ${JSON.stringify(faults)}`);
  }
});
test("a customized sender introduction is retained; the default is not repeated", () => {
  const args = { company: "Aprio", personName: "Alex Morgan", personTitle: "COO", senderName: "Suuchi Ramesh", senderTitle: "CEO" };
  assert.match(composeContactDraft({ ...args, intro: "{name} here, {title} at Nine-67." }).body, /Suuchi Ramesh here, CEO at Nine-67/);
  assert.doesNotMatch(composeContactDraft({ ...args, intro: "I am {name}, {title} at Nine-67." }).body, /I am Suuchi/);
});

test("person-specific research requires both the right domain and exact buyer", () => {
  const args = { company: "Shure", domain: "shure.com", personTitle: "Senior Director, Channel Sales" };
  const named = composeContactDraft({ ...args, personName: "Jerome Nolasco", greeting: "Hello {first},", signoff: "Best," });
  assert.match(named.body, /govern/i);
  assert.ok(named.body.startsWith("Hello Jerome,"));
  assert.ok(named.body.endsWith("?"));
  assert.notEqual(authoredDraft("Shure", "commercial", "shure.com", "Alex Smith")?.subject, named.subject);
  assert.notEqual(authoredDraft("Shure", "commercial", "other.example", "Jerome Nolasco")?.subject, named.subject);
  assert.notEqual(authoredDraft("Shure", "commercial", undefined, "Jerome Nolasco")?.subject, named.subject);
});
