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
  assert.match(cto.body, /build|stack|infrastructure|schedul\w*|pipeline|tests|scripts/i, "engineering should talk about the build");
  assert.match(ceo.body, /team|headcount|hir\w*|permanent cost/i, "an executive should talk about the hire itself");
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

test("colleagues at one company never get the same pitch, subject or ask", () => {
  // The measured failure: 480 drafts shared 4 pitch paragraphs, and a CEO, a Co-Founder and a President at
  // one company received a byte-identical subject, pitch and ask. Only the name differed.
  const company = "Consero Global";
  const team = [
    ["Ashley Honeyman", "Chief Operating Officer"],
    ["Bridget Howard", "VP - Marketing"],
    ["David Sawatzky", "Chief Executive Officer"],
    ["Jeanine Nosker", "Co-Founder"],
    ["Brock Kahanyshyn", "Chief Information Security Officer"],
    ["Jennifer Daniel", "Chief Financial Officer"],
  ] as const;
  const drafts = team.map(([personName, personTitle], index) =>
    composeContactDraft({ company, personName, personTitle, roles: ["Data Engineer"], operatingNeed: "reporting", senderName: "Suuchi Ramesh", senderTitle: "COO", variantSalt: index }));

  const pitch = (body: string) => body.split("\n\n")[2];
  const ask = (body: string) => body.split("\n\n")[3];
  assert.equal(new Set(drafts.map((d) => pitch(d.body))).size, team.length, "every colleague needs a different pitch");
  assert.equal(new Set(drafts.map((d) => ask(d.body))).size, team.length, "every colleague needs a different ask");
  assert.equal(new Set(drafts.map((d) => d.subject)).size, team.length, "every colleague needs a different subject");
});

test("four colleagues on the SAME angle still get four different letters", () => {
  // The hard case, and the one that was reported: a CEO, a Co-Founder and a President all read as the same
  // angle, so nothing about their titles can separate them. Their position in the company's list has to.
  const team = ["Chief Executive Officer", "Co-Founder", "President", "Managing Director"];
  const drafts = team.map((personTitle, index) =>
    composeContactDraft({ company: "Consero Global", personName: `Person ${index}`, personTitle, roles: ["Data Engineer"], variantSalt: index }));
  assert.equal(new Set(drafts.map((d) => d.body.split("\n\n")[2])).size, 4, "four positions, four pitches");
  assert.equal(new Set(drafts.map((d) => d.body.split("\n\n")[3])).size, 4, "four positions, four asks");
  assert.equal(new Set(drafts.map((d) => d.subject)).size, 4, "four positions, four subjects");
});

test("the same person always gets the same draft, and the salt does not change that", () => {
  const args = { company: "Acme", personName: "Lee Park", personTitle: "CFO", roles: ["Data Engineer"], variantSalt: 2 };
  assert.deepEqual(composeContactDraft(args), composeContactDraft(args), "regenerating must not reword it");
});

test("the copy pools are deep enough that the list does not read as one letter", () => {
  // Seeding subject, pitch and ask separately is what turns four options into sixty-four combinations.
  const seen = new Set<string>();
  const titles = ["CEO", "CFO", "CTO", "COO", "CISO", "CMO", "Chief People Officer", "Head of Surety"];
  for (let company = 0; company < 30; company += 1) {
    for (const [index, title] of titles.entries()) {
      const draft = composeContactDraft({ company: `Company ${company}`, personName: `Person ${index}`, personTitle: title, roles: ["Data Engineer"], variantSalt: index });
      seen.add(draft.body.split("\n\n").slice(2, 4).join(" "));
    }
  }
  // The ceiling is 8 angles x 4 pitches x 4 asks = 128 pairs; a sweep of 8 titles cannot reach all of
  // them. Before this change the same sweep produced 8. Thirty is a floor that a regression back towards
  // paired variants would break immediately.
  assert.ok(seen.size >= 30, `expected a wide spread of pitch and ask pairs, got ${seen.size}`);
});
