import test from "node:test";
import assert from "node:assert/strict";
import { outreachBody, outreachEmailHtml, senderFirstName, withOutreachName } from "./outreach-ending.ts";
import { composeContactDraft } from "./contact-draft.ts";

test("curated draft ends at its CTA despite saved pleasantry", () => {
  const draft = composeContactDraft({ company: "G&W Electric", domain: "gwelectric.com", personName: "Dave Gizewicz", personTitle: "COO", senderName: "Josh Lee", signoff: "Thank you," });
  assert.match(draft.body, /\?$/);
  assert.doesNotMatch(draft.body, /Thank you|Regards|Best,/);
});

test("name comes from sender settings, with plain and HTML signature fallback", () => {
  assert.equal(senderFirstName({ fromName: "Suuchi Ramesh", signature: "Josh Lee" }), "Suuchi");
  assert.equal(senderFirstName({ fromName: "", signature: "Thanks,\nJosh Lee\nCOO" }), "Josh");
  assert.equal(senderFirstName({ fromName: "", signature: "<div>Suuchi Ramesh</div><div>CEO</div>" }), "Suuchi");
  assert.equal(senderFirstName({ fromName: "" }), "");
});

test("legacy signoff and full signature are replaced once, after final CTA", () => {
  const original = "Hi Dave,\n\nWhat is slowing orders? We would examine one handoff.\n\nIs this worth a look?\n\nBest,\nJosh Lee\nCOO\nnine-67.com";
  const expected = "Hi Dave,\n\nWhat is slowing orders? We would examine one handoff.\n\nIs this worth a look?\n\nJosh";
  assert.equal(withOutreachName(original, { fromName: "Josh Lee" }), expected);
  assert.equal(withOutreachName(expected, { fromName: "Josh Lee" }), expected);
  assert.match(outreachBody(original), /Is this worth a look\?$/);
  assert.doesNotMatch(outreachEmailHtml(original, { fromName: "Josh Lee" }), /Best,|COO|nine-67.com/);
});
