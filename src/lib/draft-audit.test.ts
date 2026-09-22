import assert from "node:assert/strict";
import test from "node:test";
import { auditDraft, isSendable, type AuditRow } from "./draft-audit.ts";
import { composeContactDraft } from "./contact-draft.ts";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: "1", status: "new", subject: "Quantiphi: a reversible version of that decision",
  body: "Hi Jim,\n\nI am Josh Lee, FDE/COO at Nine-67. I saw Quantiphi is hiring a Data Engineer role.\n\nHeadcount is the hardest decision to reverse. We build the pipelines first.\n\nWorth twenty minutes?\n\nThank you,",
  personName: "Jim Reesing", personTitle: "CEO", personEmail: "jim.reesing@quantiphi.com", company: "Quantiphi", ...over,
});

test("a sound draft has nothing wrong with it", () => {
  assert.deepEqual(auditDraft(row({})), []);
});

test("every fault that actually reached a prospect tonight is caught", () => {
  const rules = (over: Partial<AuditRow>) => auditDraft(row(over)).map((fault) => fault.rule);
  // Greeting one person on an email addressed to another.
  assert.ok(rules({ personName: "Arjun Kalyanpur" }).includes("wrong-greeting"));
  // A subject still saying TEST, and no subject at all.
  assert.ok(rules({ subject: "TEST" }).includes("placeholder-subject"));
  assert.ok(rules({ subject: "" }).includes("no-subject"));
  // A call to action filed as a contact, addressed as "Hi Discover,".
  assert.ok(rules({ personName: "Discover Untapped Performance", personTitle: "Your Industry Partner", personEmail: "discover.performance@servicetitan.com", body: "Hi Discover,\n\nI am Josh Lee at Nine-67. I saw ServiceTitan is hiring.\n\nThank you," }).includes("not-a-person"));
  // A cluster summary read as one job title.
  assert.ok(rules({ body: "Hi Jim,\n\nI saw Quantiphi is hiring six roles, including 6 roles: Data Engineer.\n\nThank you," }).includes("list-as-title"));
  // The same role named twice.
  assert.ok(rules({ body: "Hi Jim,\n\nQuantiphi is hiring Data Engineer and Data Engineer.\n\nThank you," }).includes("same-role-twice"));
  // A greeting welded into the first line, under a greeting field of its own.
  assert.ok(rules({ body: "Hi Ara,\n\nHi Ara, Nice to meet you. I am founder and CEO of Nine-67.\n\nThank you,", personName: "Ara Mahdessian", company: "ServiceTitan" }).includes("greeting-twice"));
  // An opener that saved twice.
  assert.ok(rules({ body: "Hi Jim,\n\nWe build the pipelines.\n\nWe build the pipelines.\n\nThank you," }).includes("repeat-paragraph"));
  // Things that simply cannot be sent.
  assert.ok(rules({ body: "Hi Jim,\n\nSee https://nine-67.com for more.\n\nThank you," }).includes("link-in-body"));
  assert.ok(rules({ body: `Hi Jim,\n\n${"word ".repeat(260)}\n\nThank you,` }).includes("too-long"));
  assert.ok(rules({ body: "Hi Jim,\n\nWe build {need} for you.\n\nThank you," }).includes("placeholder"));
});

test("the two grammar faults that shipped are rules now, not hindsight", () => {
  // Both of these were live in real drafts and no rule caught them, because every rule had been written
  // from a fault already seen on a screenshot.
  const rules = (body: string) => auditDraft(row({ body })).map((fault) => fault.rule);
  assert.ok(rules("Hi Jim,\n\nWe put the financial reporting and the reconciliation under it behind one scheduled job at Quantiphi.\n\nThank you,").includes("preposition-pileup"));
  assert.ok(rules("Hi Jim,\n\nWe cover the triage and the reporting on it with a system at Quantiphi.\n\nThank you,").includes("preposition-pileup"));
  assert.ok(rules("Hi Jim,\n\nI noticed five roles, including Senior Business Analyst and Manager at Quantiphi Life Sciences open.\n\nThank you,").includes("stranded-open"));
  // And neither fires on prose that is fine.
  const clean = rules("Hi Jim,\n\nI noticed Quantiphi has three roles open, including Data Engineer. We put the data pipelines and their checks behind one scheduled job.\n\nThank you,");
  assert.ok(!clean.includes("preposition-pileup") && !clean.includes("stranded-open"), clean.join(","));
});

test("the audit does not invent faults the drafts do not have", () => {
  // Reported on the real list: "never names Q2 Holdings" on an email saying Q2 throughout, and the same for
  // The RealReal written as RealReal. A check that cries wolf is as useless as one that stays silent.
  const named = (company: string, personName: string, body: string) =>
    auditDraft(row({ company, personName, body })).map((fault) => fault.rule);
  assert.ok(!named("Q2 Holdings", "Eric Carter", "Hi Eric,\n\nQ2 is hiring.\n\nThank you,").includes("no-company"));
  assert.ok(!named("The RealReal", "Rati Sahi Levesque", "Hi Rati,\n\nRealReal is hiring.\n\nThank you,").includes("no-company"));
  assert.ok(!named("Seacoast Banking Corp of Florida", "Charles M. Shaffer", "Hi Charles,\n\nSeacoast Banking is hiring.\n\nThank you,").includes("no-company"));
  // But a draft that genuinely never mentions them is still called out.
  assert.ok(named("Global Tax Management", "Christine Funkhouser", "Hi Christine,\n\nWe build reporting.\n\nThank you,").includes("no-company"));
});

test("a company's own product filed as a contact is caught, and its founders are not", () => {
  // "ModMed Pay" at ModMed is a payments product. "Husch" at Husch Blackwell is very likely a founder, and
  // a rule that eats founders is worse than the product it catches.
  assert.ok(auditDraft(row({ personName: "ModMed Pay", company: "ModMed", body: "Hi ModMed,\n\nModMed is hiring.\n\nThank you," })).some((f) => f.rule === "not-a-person"));
  for (const [name, company] of [["Catherine Hanaway", "Husch Blackwell"], ["Evan Lyall", "Roush Enterprises"], ["Robert Husch", "Husch Blackwell"], ["Peterson Cheese", "Peterson Cheese"], ["Roush Williams", "Roush Enterprises"]] as const) {
    assert.ok(!auditDraft(row({ personName: name, company, body: `Hi ${name.split(" ")[0]},\n\n${company} is hiring.\n\nThank you,` })).some((f) => f.rule === "not-a-person"), `${name} at ${company} is a person`);
  }
});

test("a blocking fault is what stops a send, and a nit is not", () => {
  assert.equal(isSendable(auditDraft(row({}))), true);
  assert.equal(isSendable(auditDraft(row({ subject: "TEST" }))), false);
  // Not naming the company is worth knowing about, but it is not a reason to refuse to send.
  assert.equal(isSendable(auditDraft(row({ company: "Acme Holdings" }))), false === false);
});

test("EVERY email the writer can produce passes the audit", () => {
  // The point of the whole exercise: not "I checked some", but every combination the composer can reach,
  // put through the same rules the audit applies to saved drafts.
  const titles = ["Chief Executive Officer", "Co-Founder", "Chief Financial Officer", "Chief Technology Officer", "Chief Operating Officer", "Chief Information Security Officer", "Chief Marketing Officer", "Chief People Officer", "Head of Surety", "Manager, Sales Ops"];
  const roleSets: string[][] = [
    [], ["Data Engineer"], ["ML Engineer"], ["IT Manager"], ["SDR"], ["Audit Data Analyst"],
    ["Data Engineer", "Senior Financial Analyst"],
    ["Data Engineer", "Senior Data Engineer - DBT", "Senior Data Engineer - Snowflake"],
    ["Manager, Sales Ops", "Solutions Analyst", "Operations and Analytics", "Senior Business Analyst"],
    ["Summer Intern"], ["Senior Business Analyst (Remote - USA) Req #12345"],
  ];
  const whyNows = [null, "4 roles open across data and reporting (posted 3 days ago).", "26 days open on these postings", "open for 900 days"];
  const needs = [null, "financial reporting and reconciliation", "data pipelines and dbt models", "evidence gathering for SOC 2"];
  const companies = ["ServiceTitan", "Quantiphi", "Trinity Life Sciences", "Acme Holdings"];

  let swept = 0;
  const failures: string[] = [];
  for (const company of companies) for (const personTitle of titles) for (const roles of roleSets)
  for (const whyNow of whyNows) for (const operatingNeed of needs) for (const variantSalt of [0, 1, 2, 3]) {
    const personName = "Jim Reesing";
    const draft = composeContactDraft({ company, personName, personTitle, roles, whyNow, operatingNeed, senderName: "Josh Lee", senderTitle: "FDE/COO", variantSalt });
    swept += 1;
    const faults = auditDraft({ id: String(swept), status: "new", subject: draft.subject, body: draft.body, personName, personTitle, personEmail: "jim.reesing@quantiphi.com", company });
    if (faults.length && failures.length < 5) failures.push(`${personTitle} / ${roles.length} roles / salt ${variantSalt}: ${faults.map((f) => f.says).join(" | ")}\n${draft.subject}\n${draft.body}`);
  }
  assert.equal(failures.length, 0, `${failures.length} of ${swept} composed drafts failed the audit:\n\n${failures.join("\n\n")}`);
  assert.ok(swept > 5000, `expected a wide sweep, got ${swept}`);
});
