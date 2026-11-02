import test from "node:test";
import assert from "node:assert/strict";
import { internalOutreachContact, mailboxAddresses, prospectReplySender } from "./outreach-mailbox-scope.ts";
const own = new Set(["joshlee@nine-67.com", "operations@nine-67.com"]);
test("internal test and team addresses cannot become imported prospect threads", () => {
  assert.equal(internalOutreachContact("joshlee@nine-67.com", "sequence-test.nine-67.invalid", own), true);
  assert.equal(internalOutreachContact("other@nine-67.com", "nine-67.com", own), true);
  assert.equal(internalOutreachContact("real@example.com", "sequence-test.nine-67.invalid", own), true);
  assert.equal(internalOutreachContact("buyer@example.com", "example.com", own), false);
});
test("multi-recipient headers retain their first actual address", () => {
  assert.deepEqual(mailboxAddresses('joshlee@nine-67.com, "Brian Huff" <Brian_Huff@KeyBank.com>'), ["joshlee@nine-67.com", "brian_huff@keybank.com"]);
});
test("only the matched prospect can trigger reply classification or notifications", () => {
  assert.equal(prospectReplySender('Brian <brian@keybank.com>', 'joshlee@nine-67.com', own), false);
  assert.equal(prospectReplySender('Brian <brian@keybank.com>', 'brian@keybank.com', own), true);
  assert.equal(prospectReplySender('Michael <michael@keybank.com>', 'brian@keybank.com', own), false);
  assert.equal(prospectReplySender('Suuchi <operations@nine-67.com>', 'operations@nine-67.com', own), false);
});
