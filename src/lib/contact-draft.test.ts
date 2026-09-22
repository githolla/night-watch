import assert from "node:assert/strict";
import test from "node:test";
import { angleFor, composeContactDraft, rolesFromSignal } from "./contact-draft.ts";
import { greetedName, stripLeadingGreeting } from "./clean.ts";

const QUANTIPHI = {
  company: "Quantiphi",
  whyNow: "6 data and reporting roles open for 25 days.",
  operatingNeed: "They are hiring 8 roles in data and reporting; Nine-67 could build and run that work instead of adding headcount.",
  roles: ["Data Engineer - USA", "Senior Data Engineer - DBT", "Business Analyst"],
  senderName: "Suuchi Ramesh",
  senderTitle: "COO",
};

test("a title gets the angle its job actually owns", () => {
  assert.equal(angleFor("Chief Financial Officer"), "finance");
  assert.equal(angleFor("VP, Finance Transformation & Advisory Services"), "finance");
  assert.equal(angleFor("CTO"), "engineering");
  assert.equal(angleFor("VP of Application Development and Platform Engineering"), "engineering");
  assert.equal(angleFor("Chief Information Security Officer"), "security");
  assert.equal(angleFor("Chief Operating Officer"), "operations");
  assert.equal(angleFor("Chief People Officer"), "people");
  assert.equal(angleFor("VP - Marketing"), "marketing");
  assert.equal(angleFor("Co-Founder"), "executive");
  assert.equal(angleFor("CEO"), "executive");
  // Nothing recognisable still produces a usable draft rather than nothing.
  assert.equal(angleFor("Head of Surety"), "general");
});

test("colleagues at one company get genuinely different emails, not one note renamed", () => {
  const ceo = composeContactDraft({ ...QUANTIPHI, personName: "Asif Hasan", personTitle: "Co-Founder" });
  const cto = composeContactDraft({ ...QUANTIPHI, personName: "Jim Reesing", personTitle: "CTO" });
  const cfo = composeContactDraft({ ...QUANTIPHI, personName: "Reghu Hariharan", personTitle: "Chief Financial Officer" });

  // Different subject AND different body — this is the whole point of the feature.
  const subjects = new Set([ceo.subject, cto.subject, cfo.subject]);
  assert.equal(subjects.size, 3, "each role should get its own subject");
  const bodies = new Set([ceo.body, cto.body, cfo.body]);
  assert.equal(bodies.size, 3, "each role should get its own body");

  // Each is addressed to the right person, once.
  assert.equal(greetedName(ceo.body), "Asif");
  assert.equal(greetedName(cto.body), "Jim");
  assert.equal(greetedName(cfo.body), "Reghu");
  assert.ok(!stripLeadingGreeting(cto.body).includes("Jim"), "the name should not appear twice");

  // Each speaks to what that person owns.
  // Intent, not exact wording — the copy should be free to change without the test lying about it.
  assert.match(cfo.body, /cost|payroll|salary|recruiting/i, "finance should talk about money");
  assert.match(cto.body, /build|stack|infrastructure|scheduling|scripts/i, "engineering should talk about the build");
  assert.match(ceo.body, /team|headcount|hiring|permanent cost/i, "an executive should talk about growing the team");
});

test("every draft is sendable: real company, real role, no placeholders, no link", () => {
  for (const title of ["CEO", "CTO", "CFO", "COO", "CISO", "VP - Marketing", "Chief People Officer", "Head of Surety"]) {
    const draft = composeContactDraft({ ...QUANTIPHI, personName: "Dana Whitfield", personTitle: title });
    assert.ok(draft.subject.length > 0 && draft.subject.length <= 120, `subject length for ${title}`);
    assert.ok(draft.body.includes("Quantiphi"), `names the company for ${title}`);
    assert.ok(draft.body.includes("Dana"), `greets the person for ${title}`);
    assert.ok(draft.body.trim().endsWith("Thank you,"), `signs off for ${title}`);
    // The signature carries the link; a URL in the body is a duplicate, and the send guard rejects two.
    assert.ok(!/https?:\/\//.test(draft.body), `no link in the body for ${title}`);
    // Nothing unfilled ever reaches a prospect.
    assert.ok(!/\{|\}|undefined|null|NaN/.test(draft.body), `no placeholder left for ${title}`);
    // The send route caps the body at 1000 characters.
    assert.ok(draft.body.length <= 1000, `body fits the send limit for ${title} (${draft.body.length})`);
    assert.match(draft.subject, /^[A-Z0-9]/, `subject starts capitalised for ${title}`);
  }
});

test("thin data still produces a real email rather than a broken one", () => {
  const bare = composeContactDraft({ company: "Acme", personName: "Lee Park", personTitle: "CEO" });
  assert.ok(bare.body.includes("Acme"));
  assert.ok(bare.body.includes("Lee"));
  assert.ok(!/\{|undefined|null/.test(bare.body));
  assert.ok(!/\{|undefined|null/.test(bare.subject));
  // A missing name must not produce "Hi ,".
  const noName = composeContactDraft({ ...QUANTIPHI, personName: "", personTitle: "CTO" });
  assert.equal(greetedName(noName.body), "there");
});

test("two people who share an angle still get different wording", () => {
  // Quantiphi has four co-founders. One wording for all of them is the mail merge this exists to avoid.
  const founders = ["Asif Hasan", "Reghu Hariharan", "Ritesh Patel", "Vivek Khemani"].map((personName) =>
    composeContactDraft({ ...QUANTIPHI, personName, personTitle: "Co-Founder" }));
  assert.ok(new Set(founders.map((draft) => draft.body)).size > 1, "co-founders must not all get one note");

  // And the choice is stable: the same person regenerated gets the same draft, not a new one each time.
  const again = composeContactDraft({ ...QUANTIPHI, personName: "Asif Hasan", personTitle: "Co-Founder" });
  assert.equal(again.body, founders[0].body);
  assert.equal(again.subject, founders[0].subject);
});

test("the work is described as a phrase, never a fragment of the signal's prose", () => {
  const draft = composeContactDraft({ ...QUANTIPHI, personName: "Dana Whitfield", personTitle: "CTO" });
  // The bug this replaced produced "We build and run the that work instead of adding headcount".
  assert.ok(!/\bthe that\b/.test(draft.body), draft.body);
  assert.ok(!/instead of adding headcount/.test(draft.body), draft.body);
  // "headcount" appeared twice in one sentence.
  const sentences = draft.body.split(/(?<=[.?!])\s+/);
  for (const sentence of sentences) {
    assert.ok((sentence.match(/headcount/gi) ?? []).length <= 1, `repeats headcount: ${sentence}`);
  }
});

test("EVERY draft is grammatical at every role count, especially zero", () => {
  // Zero roles is the production case, not an edge case: signals.raw carries job titles under `job`, and
  // for a long time the drafter read a key zod strips — so every draft was built with roles: [].
  // Two composer rewrites fixed the symptom and this test is what should have caught the cause.
  const TITLES = ["CEO", "Co-Founder", "CFO", "Chief Financial Officer", "CTO", "Chief Technology Officer",
    "CIO", "Chief Digital Officer", "CISO", "COO", "Chief People Officer", "CMO", "VP - Marketing",
    "VP, Corporate Development", "Managing Partner", "Head of Surety", "Chief Product Officer"];
  const ROLE_SETS: string[][] = [
    [],
    ["Data Engineer"],
    ["Analytics Engineer"],
    ["Data Engineer - USA", "Business Analyst"],
    ["Senior Data Engineer - DBT", "Financial Analyst", "Operations Manager"],
  ];
  const BROKEN = [
    /\bthe a\b/i, /\bthe an\b/i, /\ba [aeiou]/, /\bthat role role\b/i, /\bthe that\b/i,
    /\bin data and reporting open\b/i, /\bhas in data and reporting\b/i,
    /\bthat work are\b/i, /\bopen, open\b/i, /\broles is filled\b/i, /\brole are filled\b/i,
    /\bthose 1 roles?\b/i, /[ \t]{2,}/, /\bundefined\b/, /\bnull\b/, /\bNaN\b/, /[{}]/,
  ];
  let checked = 0;
  for (const personTitle of TITLES) {
    for (const roles of ROLE_SETS) {
      for (const whyNow of ["", "6 data and reporting roles open for 25 days."]) {
        const draft = composeContactDraft({ company: "Acme Holdings", personName: "Lee Park", personTitle, roles, whyNow });
        for (const pattern of BROKEN) {
          assert.ok(!pattern.test(draft.body), `body matches ${pattern} for ${personTitle} / ${roles.length} roles:\n${draft.body}`);
          assert.ok(!pattern.test(draft.subject), `subject matches ${pattern} for ${personTitle} / ${roles.length} roles: ${draft.subject}`);
        }
        // Every sentence must start with a capital and end with punctuation.
        for (const line of draft.body.split("\n").filter((l) => l.trim() && l !== "Thank you,")) {
          assert.match(line.trim(), /^[A-Z“"]/, `line does not start capitalised: ${line}`);
          assert.match(line.trim(), /[.?!,]$/, `line does not end punctuated: ${line}`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked >= 150, `expected a broad sweep, checked ${checked}`);
});

test("role titles are read from the signal's job field, not a key that never exists", () => {
  // raw.roles / raw.open_roles are stripped by the ScoutSignal schema; job.title is what survives.
  assert.deepEqual(rolesFromSignal({ job: { title: "Senior Data Engineer", responsibilities: ["Build pipelines"] } }),
    ["Senior Data Engineer", "Build pipelines"]);
  assert.deepEqual(rolesFromSignal({ roles: ["Data Engineer"] }), [], "the old key carries nothing");
  assert.deepEqual(rolesFromSignal(null), []);
  assert.deepEqual(rolesFromSignal({}), []);
  assert.deepEqual(rolesFromSignal({ job: { title: "  " } }), [], "a blank title is not a role");
});
