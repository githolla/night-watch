import test from "node:test";
import assert from "node:assert/strict";
import drafts from "../../data/customized-emails.json" with { type: "json" };
import { outreachProof } from "./outreach-proof.ts";

test("443 company drafts keep unique copy and use the engagement count selectively", () => {
  assert.equal(drafts.length, 443);
  assert.equal(new Set(drafts.map(d => d.subject)).size, 443);
  assert.equal(new Set(drafts.map(d => d.message.replaceAll(d.company, "COMPANY"))).size, 443);
  const count = drafts.filter(d => /20 applications/.test(d.message)).length;
  assert.ok(count > 0 && count < 90, `${count} uses should remain a minority`);
  for (const draft of drafts) {
    assert.ok(draft.message.length > 100); // Common brand names may omit legal suffixes or source annotations.
    assert.ok(draft.message.split(/\s+/).length < 100, draft.company);
    assert.equal((draft.message.match(/\?/g) ?? []).length, 1, draft.company);
    assert.doesNotMatch(draft.message, /\b(?:guaranteed|saved \d|increased .*\d%)\b/i);
  }
});
test("proof matches the task and preserves readiness distinctions", () => {
  const reporting = outreachProof("client reporting", 1);
  assert.equal(reporting.kind, "reporting");
  assert.doesNotMatch(reporting.text, /went live|reached production|deployed/);
  assert.equal(outreachProof("RFP review", 1).kind, "proposals");
  assert.equal(outreachProof("account risk", 1).kind, "accounts");
  assert.equal(outreachProof("embedded finance partner routing", 1).kind, "process");
});
