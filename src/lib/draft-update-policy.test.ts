import test from "node:test";
import assert from "node:assert/strict";
import { preservesCurrentDraft, shouldRefreshDraft } from "./draft-update-policy.ts";
const original = { status: "new", email_subject: "Original", email_body: "Original body" };
test("the live preview applies a background revision only to unchanged untouched text", () => {
  assert.equal(preservesCurrentDraft({ ...original }, original), true);
  for (const change of [{ status: "edited" }, { status: "approved" }, { status: "sent" }, { email_subject: "Typing" }, { email_body: "Typing" }]) {
    assert.equal(preservesCurrentDraft({ ...original, ...change }, original), false);
  }
});
test("automatic refresh preserves approved, edited and previously contacted messages", () => {
  for (const status of ["edited", "approved", "sent", "replied", "archived"]) assert.equal(shouldRefreshDraft(status, true, true), false);
  assert.equal(shouldRefreshDraft("new", true, false), true);
  assert.equal(shouldRefreshDraft("new", false, false), false);
  assert.equal(shouldRefreshDraft("new", true, false, true), false);
});
