import test from "node:test";
import assert from "node:assert/strict";
import { spokenEmailAddress, VOICE_BRAND_REPLACEMENT } from "./voice-conversation.ts";

test("email spelling preserves the caller's punctuation instead of adding a dot or hyphen", () => {
  assert.equal(spokenEmailAddress("joshlee@967.com"), "j o s h l e e at 9 6 7 dot c o m");
  assert.equal(spokenEmailAddress("josh.lee@nine-67.com"), "j o s h dot l e e at n i n e hyphen 6 7 dot c o m");
});

test("spoken brand replacement fixes hyphenated names without changing email addresses", () => {
  const spoken = (text: string) => text.replace(new RegExp(VOICE_BRAND_REPLACEMENT.regex, "g"), VOICE_BRAND_REPLACEMENT.value);
  assert.equal(spoken("Alex with Nine-67. This is 9-67 calling."), "Alex with Nine Six Seven. This is Nine Six Seven calling.");
  assert.equal(spoken("operations@nine-67.com and nine-67.com"), "operations@nine-67.com and nine-67.com");
});
