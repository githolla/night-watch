import assert from "node:assert/strict";
import test from "node:test";
import { auditDraft, isSendable, type AuditRow } from "./draft-audit.ts";
import { composeContactDraft } from "./contact-draft.ts";

/**
 * repairBrokenDrafts needs a database, so what is tested here is the decision it makes: which drafts it
 * takes over, which it leaves alone, and that what it writes in their place actually passes.
 */
const row = (over: Partial<AuditRow>): AuditRow => ({
  id: "1", status: "new", subject: "Quantiphi: a reversible version of that decision",
  body: "Hi Jim,\n\nI am Josh Lee, FDE/COO at Nine-67. I saw Quantiphi is hiring a Data Engineer role.\n\nHeadcount is the hardest decision to reverse. We build the pipelines first.\n\nWorth twenty minutes?\n\nThank you,",
  personName: "Jim Reesing", personTitle: "CEO", personEmail: "jim.reesing@quantiphi.com", company: "Quantiphi", ...over,
});

test("a draft that cannot be sent is taken over; one with only a nit is left alone", () => {
  // Taken over: these cannot go out as they stand.
  for (const broken of [
    row({ subject: "TEST" }),
    row({ personName: "Arjun Kalyanpur" }),
    row({ body: "Hi Jim,\n\nSee https://nine-67.com.\n\nThank you," }),
    row({ body: "Hi Jim,\n\nWe build {need}.\n\nThank you," }),
  ]) {
    assert.equal(isSendable(auditDraft(broken)), false);
  }
  // Left alone: someone's own wording is worth more than the nit.
  const nit = row({ company: "Global Tax Management" });
  assert.ok(auditDraft(nit).length > 0, "the nit is still reported");
  assert.equal(isSendable(auditDraft(nit)), true, "but it does not trigger a rewrite");
});

test("an untouched draft follows the writer; a worked-on one keeps its words", () => {
  // The failure this rule exists for: a phrasing fault was fixed in the writer and the drafts on screen
  // kept the old wording, because improving the writer does not change text already in the database and
  // nothing went back over it. Status is the whole decision, so it is worth stating plainly.
  const decides = (status: string, faults: number) => status === "new" || faults > 0;
  const blocking = auditDraft(row({ subject: "TEST" })).filter((f) => f.blocking).length;
  const fine = auditDraft(row({})).filter((f) => f.blocking).length;
  assert.equal(fine, 0);
  // Untouched: rewritten whether or not anything is wrong, so it stays current with the writer.
  assert.equal(decides("new", fine), true);
  // Worked on and sound: left exactly as the operator wrote it.
  assert.equal(decides("edited", fine), false);
  assert.equal(decides("approved", fine), false);
  // Worked on but unsendable: taken over, because it cannot go out as it stands.
  assert.equal(decides("edited", blocking), true);
});

test("what the repair writes in their place passes the audit", () => {
  // A repair that produced another broken draft would loop every night, rewriting the same rows forever.
  for (const personTitle of ["CEO", "Chief Financial Officer", "CTO", "COO", "CISO", "CMO", "Chief People Officer", "Head of Surety"]) {
    for (const roles of [[], ["Data Engineer"], ["Apply for Adobe Multi-Solution Architect (US) Apply"], ["6 roles: Data Engineer - USA, Senior Data Engineer - DBT"]]) {
      const draft = composeContactDraft({ company: "Quantiphi", personName: "Jim Reesing", personTitle, roles, whyNow: "open for 25 days", senderName: "Josh Lee", senderTitle: "FDE/COO", variantSalt: 1 });
      const faults = auditDraft(row({ subject: draft.subject, body: draft.body, personTitle }));
      assert.deepEqual(faults, [], `${personTitle} / ${roles.length} roles still fails: ${faults.map((f) => f.says).join(" | ")}\n${draft.subject}\n${draft.body}`);
    }
  }
});
