import assert from "node:assert/strict";
import test from "node:test";
import { lintEmail } from "../../tools/email-writer/src/lint.ts";
import { auditDraft } from "./draft-audit.ts";
import { firstTouchErrors } from "./first-touch.ts";
import { AUTO_ARMS, checkWorkflow, chooseArm, listVariants, normalizeWorkflow, openingLine, repairWorkflow, speakableCompany, variantProblems, type Workflow } from "./list-templates.ts";

const workflow: Workflow = { task: "branch service follow-up", subject: "branch follow-ups", inputs: "site inspection notes, the promised fix and evidence that it was completed", metric: "time spent chasing updates" };
const now = new Date("2026-10-01T12:00:00Z");
const BANNED_OPENERS = ["I noticed", "I saw", "Noticed", "Saw that", "Saw you", "I came across", "I was looking at", "Hope this", "I hope", "My name is", "I'm reaching out", "I am reaching out", "I wanted to", "As a", "Congrats on", "Congratulations on"];

test("speakableCompany keeps the name people say", () => {
  const cases: Array<[string, string]> = [
    ["Acme Landscaping, LLC", "Acme Landscaping"],
    ["The Greenleaf Group, Inc.", "Greenleaf Group"],
    ["ABC Mechanical (ABC Services)", "ABC Mechanical"],
    ["Brightview Holdings", "Brightview Holdings"],
    ["The Group", "The Group"],
    ["BELFOR USA Group Inc.", "BELFOR USA Group"],
    ["Turner Construction Co.", "Turner Construction"],
    ["Smith & Sons, L.L.C.", "Smith & Sons"],
    ["Acme Holdings LLC d/b/a Acme Pest Control", "Acme Pest Control"],
    ["Rollins Pest Atlantic Holdings", "Rollins Pest Atlantic"],
    ["Inc.", "Inc."],
    ["   ", ""],
  ];
  for (const [input, expected] of cases) assert.equal(speakableCompany(input), expected, input);
});

test("draft audit still finds the company when the copy uses the shortened name", () => {
  for (const company of ["Acme Landscaping, LLC", "The Greenleaf Group, Inc.", "BELFOR USA Group Inc.", "Smith & Sons, L.L.C."]) {
    const body = `Hi Pat,\n\nFor ${speakableCompany(company)}, I'd start with dispatch notes.\n\nWould that help?`;
    const faults = auditDraft({ id: "1", status: "new", subject: "dispatch notes", body, personName: "Pat Lee", personTitle: "COO", personEmail: "pat@example.com", company });
    assert.ok(!faults.some((fault) => fault.rule === "no-company"), company);
  }
});

test("workflow text may not carry invented specifics", () => {
  const context = { company: "Mainscape, Inc.", domain: "mainscape.com", allowedNames: ["ServiceTitan"] };
  for (const bad of [
    { ...workflow, inputs: "visit notes from 14 branches" },
    { ...workflow, inputs: "your crew GPS and visit notes" },
    { ...workflow, task: "their dispatch board updates" },
    { ...workflow, inputs: "visit notes and our checklists" },
    { ...workflow, inputs: "visit notes, the fix and Mainscape quality checks" },
    { ...workflow, subject: "mainscape follow-ups" },
    { ...workflow, inputs: "visit notes from the Denver office" },
  ]) assert.ok("problem" in checkWorkflow(bad, context), JSON.stringify(bad));
  assert.ok("problem" in checkWorkflow({ ...workflow, inputs: "ServiceTitan job notes" }, { company: "Mainscape" }), "a name not in the allowlist");
  assert.ok("workflow" in checkWorkflow({ ...workflow, inputs: "CRM notes and site inspection photos" }, context));
  assert.ok("workflow" in checkWorkflow({ ...workflow, inputs: "ServiceTitan job notes and the promised fix" }, context));
  assert.ok("workflow" in checkWorkflow({ ...workflow, inputs: "visit notes, its open issues and the fix" }, context), "its stays allowed");
  assert.ok("workflow" in checkWorkflow(workflow, context));
});

test("normalizeWorkflow fixes punctuation for free", () => {
  const raw = { ...workflow, subject: "Branch Follow-ups — Fast", inputs: "notes — fixes", task: "is follow-up slow?" };
  assert.ok("problem" in checkWorkflow(raw));
  const fixed = normalizeWorkflow(raw);
  assert.equal(fixed.subject, "branch follow-ups, fast");
  assert.equal(fixed.inputs, "notes, fixes");
  assert.equal(fixed.task, "is follow-up slow");
  assert.ok("workflow" in checkWorkflow(fixed));
});

test("repairWorkflow makes one attempt with the injected agent", async () => {
  const context = { company: "Mainscape", domain: "mainscape.com" };
  const prompts: string[] = [];
  const good = await repairWorkflow({ ...workflow, inputs: "14 branches of notes" }, ["workflow inputs has a number"], "Hiring: Dispatcher", async (prompt) => { prompts.push(prompt); return workflow; }, context);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /workflow inputs has a number/);
  assert.match(prompts[0], /Hiring: Dispatcher/);
  assert.ok("workflow" in good);
  assert.deepEqual(good.workflow, workflow);
  assert.deepEqual(variantProblems(good.variants), []);

  let calls = 0;
  const bad = await repairWorkflow(workflow, ["x"], "", async () => { calls++; return { ...workflow, inputs: "your 14 branches" }; }, context);
  assert.equal(calls, 1);
  assert.ok("problem" in bad);

  const text = await repairWorkflow(workflow, ["x"], "", async () => `Here you go: ${JSON.stringify(workflow)}`, context);
  assert.ok("workflow" in text, "a JSON reply wrapped in text still parses");
  assert.ok("problem" in await repairWorkflow(workflow, ["x"], "", async () => { throw new Error("offline"); }, context));
  assert.ok("problem" in await repairWorkflow(workflow, ["x"], "", async () => ({ task: 1 }), context));
});

const hiring = (title: string, postedDate: string | null) => ({ hiring: [{ title, postedDate }], scale: null });

test("a fresh automatable hire opens the direct offer with the exact title", () => {
  const variants = listVariants("Mainscape", workflow, hiring("Dispatch Coordinator", "2026-09-20"), { now });
  assert.ok(variants[0].message.startsWith("Mainscape is hiring a Dispatch Coordinator, which usually means more branch service follow-up done by hand.\n\nI'm {sender} at Nine-67."));
  assert.equal(variants[1].message, listVariants("Mainscape", workflow)[1].message, "other versions are unchanged");
  assert.match(String(openingLine("Mainscape", "order entry", hiring("Estimator", "2026-09-20"), now)), /hiring an Estimator,/);
  assert.match(String(openingLine("Mainscape", "order entry", hiring("HR Administrator", "2026-09-20"), now)), /hiring an HR Administrator,/);
});

test("undated, stale or non-automatable hires give no line", () => {
  const plain = listVariants("Mainscape", workflow);
  for (const evidence of [hiring("Dispatch Coordinator", null), hiring("Dispatch Coordinator", "2026-06-23"), hiring("Software Engineer Lead", "2026-09-20"), hiring("Dispatch Coordinator", "not a date")]) {
    assert.deepEqual(listVariants("Mainscape", workflow, evidence, { now }), plain);
  }
});

test("a title that fails sanitizing falls back to the plain template", () => {
  const plain = listVariants("Mainscape", workflow);
  for (const title of ["Dispatcher 2nd Shift", "Billing Clerk - Remote", "Scheduler (apply at acme.com)", "Data Entry Clerk?", "Dispatch Coordinator for the North East Regional Branch Operations Center"]) {
    assert.deepEqual(listVariants("Mainscape", workflow, hiring(title, "2026-09-20"), { now }), plain, title);
  }
});

test("a sourced location count is used when no hire qualifies, and only with a source", () => {
  const scaled = listVariants("Mainscape", workflow, { hiring: [], scale: { locations: 12, url: "https://mainscape.com/locations" } }, { now });
  assert.ok(scaled[0].message.startsWith("Across 12 locations, branch service follow-up tends to happen by hand at each one."));
  assert.deepEqual(listVariants("Mainscape", workflow, { scale: { locations: 12, url: null } }, { now }), listVariants("Mainscape", workflow));
  assert.deepEqual(listVariants("Mainscape", workflow, { scale: { locations: 2, url: "https://mainscape.com" } }, { now }), listVariants("Mainscape", workflow));
});

test("a line that would break the email limits falls back to the plain version", () => {
  const long = { ...workflow, inputs: "site inspection notes, the promised fix, evidence that it was completed, crew photos, customer sign off, the open issue log, the weekly branch summary, the account manager notes, the parts order list, the invoice draft and the quality review history" };
  assert.deepEqual(variantProblems(listVariants("Mainscape", long)), [], "the plain version still fits");
  assert.deepEqual(listVariants("Mainscape", long, hiring("Dispatch Coordinator", "2026-09-20"), { now }), listVariants("Mainscape", long));
});

test("every output passes the first-touch rules and lint, at most 120 words, with no banned opener", () => {
  const evidences = [undefined, hiring("Dispatch Coordinator", "2026-09-20"), hiring("Estimator", "2026-09-01"), { scale: { locations: 40, url: "https://mainscape.com/locations" } }];
  for (const evidence of evidences) {
    for (const variant of listVariants("Mainscape", workflow, evidence, { now })) {
      const message = variant.message.replaceAll("{sender}", "Josh");
      assert.deepEqual(firstTouchErrors(variant.subject, `Hi Pat,\n\n${message}`), []);
      const lint = lintEmail({ touch: 1, subject: variant.subject, body: message });
      assert.deepEqual(lint.issues.filter((issue) => issue.severity === "error"), [], variant.id);
      assert.ok(message.trim().split(/\s+/).length <= 120);
      for (const opener of BANNED_OPENERS) assert.ok(!message.toLowerCase().startsWith(opener.toLowerCase()), `${variant.id} opens with ${opener}`);
    }
  }
});

test("chooseArm is stable per domain, even across domains, and never picks delivery-experience", () => {
  const variants = listVariants("Mainscape", workflow);
  assert.deepEqual(AUTO_ARMS, ["direct-offer", "concrete-idea"]);
  const first = chooseArm("mainscape.com", variants);
  assert.deepEqual(chooseArm("https://www.Mainscape.com/", variants), first);
  assert.equal(first.variants[0].id, first.armId);
  assert.deepEqual(new Set(first.variants.map((variant) => variant.id)), new Set(variants.map((variant) => variant.id)));
  const counts: Record<string, number> = {};
  for (let index = 0; index < 1000; index++) {
    const { armId, variants: ordered } = chooseArm(`company-${index}.example`, variants);
    assert.notEqual(armId, "delivery-experience");
    assert.equal(ordered[0].id, armId);
    counts[String(armId)] = (counts[String(armId)] ?? 0) + 1;
  }
  for (const arm of AUTO_ARMS) assert.ok(counts[arm] >= 450 && counts[arm] <= 550, `${arm}: ${counts[arm]}`);
  const onlyDelivery = variants.filter((variant) => variant.id === "delivery-experience");
  assert.deepEqual(chooseArm("x.com", onlyDelivery), { variants: onlyDelivery, armId: null });
});

test("a company whose name contains a banned word (landscape) still gets copy, and the word stays banned elsewhere", () => {
  const workflow = { task: "crew schedule changes", subject: "schedule changes", inputs: "weather delays, crew availability and customer notices", metric: "time spent rescheduling" };
  const variants = listVariants("Mainscape Landscape", workflow);
  assert.deepEqual(variantProblems(variants, undefined, "Mainscape Landscape"), []);
  assert.ok(variantProblems(variants).some((issue) => /banned_phrase landscape/.test(issue)), "without the name the rule still fires");
  const jargon = variants.map((variant) => ({ ...variant, message: `${variant.message}\nThe AI landscape is changing.` }));
  assert.ok(variantProblems(jargon, undefined, "Mainscape Landscape").some((issue) => /banned_phrase landscape/.test(issue)), "the word outside the name is still caught");
});
