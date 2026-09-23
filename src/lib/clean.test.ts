import assert from "node:assert/strict";
import test from "node:test";
import { isRealContact, cleanRoleTitle, greetedName, sanitizeCopy, SIGNOFF_OPENERS, stripLeadingGreeting } from "./clean.ts";

test("strips ATS requisition ids from a title", () => {
  assert.equal(cleanRoleTitle("Lead Data Engineer A1wuq000001tvyf2ae"), "Lead Data Engineer");
  assert.equal(cleanRoleTitle("AWS Cloud Data Engineer"), "AWS Cloud Data Engineer");
});

test("sanitizeCopy removes embedded req ids from a sentence", () => {
  const raw = "They are hiring 41 roles (Continuous Improvement Lead A1wuq000001ljan2ai, AWS Cloud Data Engineer); Nine-67 could build it.";
  const out = sanitizeCopy(raw);
  assert.ok(!/A1wuq000001ljan2ai/.test(out), "req id should be gone");
  assert.ok(/AWS Cloud Data Engineer/.test(out));
});

test("sanitizeCopy leaves clean copy untouched", () => {
  const clean = "They are hiring 4 roles in data and reporting; Nine-67 could build that instead.";
  assert.equal(sanitizeCopy(clean), clean);
});


test("a seat's own greeting is still recognised as a greeting", () => {
  // Each seat writes their own opening line now. One the matcher does not know is not treated as a
  // greeting at all, and the composer then shows the Greeting field AND leaves the greeting in the
  // message — the doubled "Hi Ara, Nice to meet you" that had just been fixed, straight back.
  for (const opener of ["Hi", "Hey", "Hello", "Dear", "Greetings", "Good morning", "Good afternoon", "Good evening", "Morning"]) {
    const body = `${opener} Ara,\n\nI am Josh Lee at Nine-67.\n\nThank you,`;
    assert.equal(greetedName(body), "Ara", `"${opener} Ara," should be read as a greeting`);
    assert.ok(!stripLeadingGreeting(body).startsWith(opener), `"${opener}" should be stripped`);
  }
  // And a real opening sentence is still not mistaken for one.
  assert.equal(greetedName("We build the reporting and data work.\n\nThank you,"), null);
});

test("a seat's own sign-off is still recognised as a sign-off", () => {
  for (const line of ["Thanks,", "Thank you,", "Best,", "Best wishes,", "All the best,", "Kind regards,", "Cheers,", "Warmly,", "Sincerely,", "Speak soon,", "Appreciate it,", "Respectfully,"]) {
    assert.ok(SIGNOFF_OPENERS.test(line), `"${line}" is a sign-off`);
  }
  // A sentence is not a sign-off, however it starts.
  assert.ok(!SIGNOFF_OPENERS.test("We build the reporting and data work."));
  assert.ok(!SIGNOFF_OPENERS.test("Worth twenty minutes to compare the two?"));
});

test("department labels from the worklist are not people", () => {
  for (const full_name of ["Domestic Sales", "Human Resources", "Advanced Manufacturing Engineering", "Mbaf Mold-Direct"]) {
    assert.equal(isRealContact({ full_name, title: "Director, Supplier Quality" }), false, full_name);
  }
  assert.equal(isRealContact({ full_name: "Dave Gizewicz", title: "Chief Operating Officer" }), true);
});
