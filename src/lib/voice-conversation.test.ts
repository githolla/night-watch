import test from "node:test";
import assert from "node:assert/strict";
import { spokenEmailAddress } from "./voice-conversation.ts";

test("email spelling preserves the caller's punctuation instead of adding a dot or hyphen", () => {
  assert.equal(spokenEmailAddress("joshlee@967.com"), "j o s h l e e at 9 6 7 dot c o m");
  assert.equal(spokenEmailAddress("josh.lee@nine-67.com"), "j o s h dot l e e at n i n e hyphen 6 7 dot c o m");
});
