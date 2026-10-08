import test from 'node:test';
import assert from 'node:assert/strict';
import {leftoverSourceNames, replaceOpening, retargetCopy} from './bulk-copy.ts';
test('bulk opening preserves individual greetings, company detail and CTA',()=>{
 for(const name of ['Louis','Douglas']){
 const body=`Hi ${name},\n\nOld opening.\n\nCompany-specific detail.\n\nInterested?`;
 const expected=`Hi ${name},\n\nNew opening.\n\nCompany-specific detail.\n\nInterested?`;
 assert.equal(replaceOpening(body,'New opening.'),expected);
 assert.equal(replaceOpening(expected,'New opening.'),expected);
 }
});
test('handles older single-newline greetings and bodies with no greeting',()=>{
 assert.equal(replaceOpening('Hello Louis,\nOld opener.\n\nInterested?','New.'),'Hello Louis,\n\nNew.\n\nInterested?');
 assert.equal(replaceOpening('Old opener.\n\nDetails.\n\nInterested?','New.'),'New.\n\nDetails.\n\nInterested?');
});

test("a batch-applied subject or message carries each company's own name, never the source company's", () => {
  const from = { company: "Dortch Enterprises / Great Lakes Taco", person: "Louis Dortch Jr." };
  const to = { company: "Nationwide Construction Group", person: "Scott Keller" };
  assert.equal(retargetCopy("restaurant equipment repairs at Dortch Enterprises", from, to, false), "restaurant equipment repairs at Nationwide Construction Group");
  const message = "Hi Louis,\n\nDortch Enterprises is hiring a dispatcher.\n\nWould help with scheduling be useful?";
  assert.equal(retargetCopy(message, from, to, true), "Hi Scott,\n\nNationwide Construction Group is hiring a dispatcher.\n\nWould help with scheduling be useful?");
  assert.equal(retargetCopy("Hi Louis, thanks Louis", from, to, false), "Hi Louis, thanks Louis", "a subject never touches first names");
  assert.equal(retargetCopy("Quick question about operations", from, to, true), "Quick question about operations", "text without the source names is copied as is");
  assert.equal(retargetCopy("Hello Louis,\n\nA note for Acme Co. today.", { company: "Acme Co.", person: "Louis" }, { company: "Bolt LLC", person: "Ann Lee" }, true), "Hello Ann,\n\nA note for Bolt LLC today.");
});

test("a copy that would still carry the source company's name or the person's first name is caught", () => {
  const from = { company: "ABC Holdings LLC", person: "Louis Dortch" };
  const to = { company: "Nationwide Construction Group", person: "Scott Keller" };
  // The account is filed as "ABC Holdings LLC" but the email says "ABC": no form matches, so it is not swapped.
  const copied = retargetCopy("Hi Louis,\n\nFor ABC, one idea is scheduling.\n\nWould that help?", from, to, true);
  assert.deepEqual(leftoverSourceNames(copied, from, to), ["abc"]);
  assert.deepEqual(leftoverSourceNames(retargetCopy("Hi Louis,\n\nLouis, I saw the news.\n\nWould that help?", from, to, true), from, to), ["louis"]);
  // Fully swapped copy: nothing left over. Shared generic words (Construction, Group) never count.
  const clean = retargetCopy("Hi Louis,\n\nFor ABC Holdings LLC, a construction group idea.\n\nWould that help?", from, to, true);
  assert.deepEqual(leftoverSourceNames(clean, from, to), []);
  assert.deepEqual(leftoverSourceNames("Quick question about operations", { company: "Dortch Enterprises / Great Lakes Taco", person: "Louis" }, to), []);
});

test("everyday words that happen to be in a company's name are not mistaken for it", () => {
  const from = { company: "Great Lakes Taco", person: "Louis Dortch" };
  const to = { company: "Village Green", person: "Matthew Guenther" };
  assert.deepEqual(leftoverSourceNames("Hi Matthew,\n\nThis could be a great fit. Great teams often start small.\n\nWould that help?", from, to), []);
  assert.deepEqual(leftoverSourceNames("Hi Matthew,\n\nLike Great Lakes, you run many sites.\n\nWould that help?", from, to), ["great", "lakes"]);
});
