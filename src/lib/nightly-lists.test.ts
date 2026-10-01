import assert from "node:assert/strict";
import test from "node:test";
import offers from "../../data/batch-3-offers.json" with { type: "json" };
import focus from "../../data/batch-3-focus.json" with { type: "json" };
import { checkWorkflow, listVariants, variantProblems } from "./list-templates.ts";
import { autoSendBlocker, bounceBrake, paceForRun } from "./morning-send-rules.ts";
import { selectedBatch } from "./reachout-batches.ts";
import { batchOwner, focusForOwner, hasTodayList, reachoutList } from "./focus-data.ts";
import { isCuratedDomain } from "./curated-worklist.ts";
import { researchRecommendation } from "./research-recommendation.ts";
import { setNightlyLists, type ListOffer, type ListRow } from "./research-data/server.ts";
import { researchSlice } from "./research-data/slice.ts";
import { buildFollowups, refreshLegacyFollowup } from "./followups.ts";
import { outreachDelivery } from "./outreach-ending.ts";
import { localParts } from "./local-time.ts";

const workflow = { task: "branch service follow-up", subject: "branch follow-ups", inputs: "site inspection notes, the promised fix and evidence that it was completed", metric: "time spent chasing updates" };

test("nightly copy is the approved batch-3 wording, word for word", () => {
  let same = 0;
  for (const offer of offers) {
    const row = focus.find((item) => item.domain === offer.domain)!;
    const inputs = offer.variants[0].message.match(/: bringing together (.+?)\. We'd learn/)?.[1] ?? "";
    const metric = offer.variants[1].message.match(/measure (.+?)\.\n/)?.[1] ?? "";
    const generated = listVariants(row.company, { task: row.reframe, subject: offer.variants[0].subject, inputs, metric });
    for (let index = 0; index < 3; index++) if (generated[index].message === offer.variants[index].message && generated[index].linkedinMessage === offer.variants[index].linkedinMessage) same++;
  }
  assert.ok(same >= 145, `templates drifted from batch 3: ${same}/150 match`);
});

test("every generated version passes the writer-kit lint and first-touch rules", () => {
  assert.deepEqual(variantProblems(listVariants("Mainscape", workflow)), []);
});

test("a researched idea with a question, a dash, a link or too many words is refused", () => {
  assert.ok("workflow" in checkWorkflow(workflow));
  assert.ok("problem" in checkWorkflow({ ...workflow, task: "is follow-up slow?" }));
  assert.ok("problem" in checkWorkflow({ ...workflow, inputs: "notes — fixes" }));
  assert.ok("problem" in checkWorkflow({ ...workflow, metric: "see acme.com" }));
  assert.ok("problem" in checkWorkflow({ ...workflow, subject: "a very long subject line here" }));
  const cleaned = checkWorkflow({ ...workflow, task: "Branch service follow-up." });
  assert.ok("workflow" in cleaned && cleaned.workflow.task === "branch service follow-up");
});

test("the morning send spreads the list across the window", () => {
  assert.equal(paceForRun(12, 9 * 60), 1, "fifteen runs left: one each");
  assert.equal(paceForRun(12, 11 * 60 + 20), 12, "last run sends the rest");
  assert.equal(paceForRun(12, 11 * 60 + 30), 0, "nothing after the window");
  assert.equal(paceForRun(0, 10 * 60), 0);
});

test("the bounce brake needs 20 sends and then trips above 5%", () => {
  assert.equal(bounceBrake(10, 2), false, "too few sends to judge");
  assert.equal(bounceBrake(20, 1), false, "exactly 5% is allowed");
  assert.equal(bounceBrake(20, 2), true);
});

test("auto-send runs only when on, not paused, and with a postal address", () => {
  assert.equal(autoSendBlocker({ autoSend: false, paused: false, postalAddress: "1 Main St" }), "auto-send is off");
  assert.equal(autoSendBlocker({ autoSend: true, paused: true, postalAddress: "1 Main St" }), "auto-send is paused");
  assert.match(String(autoSendBlocker({ autoSend: true, paused: false, postalAddress: "" })), /postal address/);
  assert.equal(autoSendBlocker({ autoSend: true, paused: false, postalAddress: "1 Main St" }), null);
});

test("a nightly list becomes Today's list for its owner, with offers and ownership", () => {
  const row = { ...focus[0], domain: "nightly-example.test", company: "Nightly Example", assignedOwner: "suuchi" } as ListRow;
  const offer = { ...offers[0], domain: "nightly-example.test" } as ListOffer;
  setNightlyLists({ nightlyFocus: [row], nightlyOffers: [offer], nightlyLatest: { josh: [], suuchi: ["nightly-example.test"] } });
  try {
    assert.equal(selectedBatch("today", 1), 3);
    assert.equal(focusForOwner("jenna", 3).length, 1);
    assert.equal(focusForOwner("josh", 3).length, 0);
    assert.equal(hasTodayList("jenna"), true);
    assert.equal(batchOwner("nightly-example.test"), "jenna");
    assert.equal(reachoutList("suuchi", "jenna", 3).href, "/outreach?list=suuchi&batch=today");
    assert.ok(researchRecommendation("nightly-example.test", offer.contactName), "its versions are found like a curated company's");
    assert.equal(isCuratedDomain("nightly-example.test"), false, "automatic copy keeps the reply-no line");
    const slice = researchSlice(["nightly-example.test"]);
    assert.equal(slice.nightlyFocus[0].contacts.length, row.contacts.length, "full row for a company on screen");
    assert.equal(researchSlice(["other.test"]).nightlyFocus[0].contacts.length, 0, "thin row for one off screen");
  } finally {
    setNightlyLists({ nightlyFocus: [], nightlyOffers: [], nightlyLatest: { josh: [], suuchi: [] } });
  }
});

test("follow-ups are two steps, and older three-step sequences still map", () => {
  const steps = buildFollowups("email", { firstName: "Pat", company: "Acme", baseSubject: "order intake" });
  assert.deepEqual(steps.map((step) => step.day), [3, 10]);
  assert.match(steps[1].body, /leave this with you/);
  const retired = "Floating this back up in case it slipped by";
  assert.match(refreshLegacyFollowup(retired, { firstName: "Pat", company: "Acme", baseSubject: "x", step: 3, channel: "email" }), /leave this with you/);
});

test("the postal address is printed under the signature in both parts", () => {
  const delivery = outreachDelivery("Hi Pat,\n\nIs this useful?", { fromName: "Josh Lee", signature: "Josh Lee", postalAddress: "123 Main St\nPittsburgh, PA 15222" });
  assert.match(delivery.text, /123 Main St, Pittsburgh, PA 15222$/);
  assert.match(delivery.html, /123 Main St, Pittsburgh, PA 15222/);
});

test("the list date follows the operators' clock, not UTC", () => {
  assert.equal(localParts(new Date("2026-10-02T03:30:00Z"), "America/New_York").date, "2026-10-01");
  assert.equal(localParts(new Date("2026-10-02T06:30:00Z"), "America/New_York").date, "2026-10-02");
});
