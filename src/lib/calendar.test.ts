import assert from "node:assert/strict";
import test from "node:test";
import { matchProposedSlot, checkedBusy } from "./calendar.ts";

const slots = [
  { start: "2035-10-21T14:00:00Z", end: "2035-10-21T14:30:00Z", label: "Tue, Oct 21, 10:00 AM EDT" },
  { start: "2035-10-22T17:00:00Z", end: "2035-10-22T17:30:00Z", label: "Wed, Oct 22, 1:00 PM EDT" },
];

test("books a slot the reply clearly names (weekday + date)", () => {
  const slot = matchProposedSlot("Tuesday the 21st works great for me", slots);
  assert.equal(slot?.start, "2035-10-21T14:00:00Z");
});

test("books on weekday + time", () => {
  const slot = matchProposedSlot("wednesday at 1:00 pm is perfect", slots);
  assert.equal(slot?.start, "2035-10-22T17:00:00Z");
});

test("an ambiguous yes books nothing", () => {
  assert.equal(matchProposedSlot("yes, sounds good — let's talk", slots), null);
});

test("a single weak cue is not enough", () => {
  assert.equal(matchProposedSlot("Tuesday maybe?", slots), null);
});

for(const text of ["Happy to talk, but Tuesday at 10am does not work. Could we find another time?", "Tuesday at 10am maybe", "Tuesday at 10am?", "Yes\n> Tuesday Oct 21 at 10am works", "Tuesday at 10am does not work but Wednesday at 1pm works"]){
 test(`does not book ambiguous or declined reply: ${text}`,()=>assert.equal(matchProposedSlot(text,slots),null));
}
test('expired slots never match',()=>assert.equal(matchProposedSlot('Tuesday the 21st works',slots,Date.parse('2040-01-01')),null));
test('calendar-level errors and missing data fail closed',()=>{for(const input of [{},{calendars:{primary:{errors:[{reason:'notFound'}]}}},{calendars:{primary:{busy:[{start:'bad',end:'bad'}]}}}])assert.throws(()=>checkedBusy(input));assert.deepEqual(checkedBusy({calendars:{primary:{busy:[]}}}),[])});
