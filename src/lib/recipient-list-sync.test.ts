import test from "node:test";
import assert from "node:assert/strict";
import { updatedRecipientRow } from "./recipient-list-sync.ts";
test("published replacements update the selected buyer and preserve every colleague", () => {
  const row = { company: "Acme", buyer: { name: "Todd Leyse", email: "todd.leyse@co.test" }, contacts: [{ name: "Todd Leyse", email: "todd.leyse@co.test" }, { name: "Other Person", email: "other@co.test" }], emailCheck: { email: "todd.leyse@co.test" } };
  const changed = updatedRecipientRow(row, { full_name: "Todd Leyse", email: "tleyse@co.test", email_source: "published", email_check: { email: "tleyse@co.test", bouncedEmails: ["todd.leyse@co.test"], evidenceUrl: "https://co.test/team" } }) as typeof row;
  assert.equal(changed.buyer.email, "tleyse@co.test"); assert.equal(changed.contacts[0].email, "tleyse@co.test"); assert.equal(changed.contacts[1].email, "other@co.test"); assert.equal(changed.emailCheck.email, "tleyse@co.test");
});
test("a different buyer's list is untouched", () => {
  const row = { buyer: { name: "Someone Else", email: "someone@co.test" }, contacts: [] };
  assert.equal(updatedRecipientRow(row, { full_name: "Todd Leyse", email: "tleyse@co.test", email_source: "published", email_check: {} }), row);
});
