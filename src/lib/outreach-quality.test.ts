import {test} from "node:test";
import assert from "node:assert/strict";
import {outreachQualityFailures, generateCheckedOutreach} from "./outreach-quality.ts";
const context = {reframe: "The bottleneck is getting each order ready to build, not plant capacity.", senderName: "Josh Lee"};
const body = "Getting each order ready to build can be the bottleneck.\n\nWould checking this handoff help?";
test("reframe requires three distinct content words, not stopwords", () => {
 assert.deepEqual(outreachQualityFailures(body, context), []);
 assert.ok(outreachQualityFailures("Is it the one that we would do?", context).some(s => s.includes("reframe")));
});
test("CTA must be final except explicitly allowed sender", () => {
 assert.deepEqual(outreachQualityFailures(body + "\n\nJosh", context), []);
 for(const ending of ["Thanks,\nJosh", "Another benefit.", "P.S. Let me know?", "Regards,"]) assert.ok(outreachQualityFailures(body + "\n" + ending, context).some(s => s.includes("Delete everything")));
 assert.ok(outreachQualityFailures(body + " Extra pitch", context).some(s=>s.includes("Delete everything")));
});
test("raw subject and body dashes rejected before sanitizing", () => {
 assert.ok(outreachQualityFailures(body + "—", context).some(s=>s.includes("dashes")));
 assert.ok(outreachQualityFailures(body, context, "order – check").some(s=>s.includes("dashes")));
});
test("retries rejected generation and returns only validated result", async()=> {
 let calls=0;
 const result = await generateCheckedOutreach(async feedback=>{calls++;if(calls>1)assert.match(feedback,/rejected/);return {body:calls===1?"A generic note?":body};},context);
 assert.equal(calls,2);assert.equal(result.body,body);
});
test("never returns bad third attempt or falls back to old draft",async()=> {
 let calls=0;
 await assert.rejects(generateCheckedOutreach(async()=>{calls++;return {body:"No question"};},context),/three attempts/);
 assert.equal(calls,3);
});
test("semantic avoid-list critic rejects and provides corrective retry", async()=> {
 let calls=0;let critiques=0;
 await generateCheckedOutreach(async feedback=>{calls++;if(calls>1)assert.match(feedback,/unverified revenue/);return {body};},context,async()=> ++critiques===1?["avoid: unverified revenue"]:[]);
 assert.equal(calls,2);
});

test("cold email needs a company explanation, not only a brand or signature", () => {
 const cold = {requireIntroduction: true};
 assert.ok(outreachQualityFailures("Nine-67.\n\nWould that help?", cold).some(s => s.includes("Introduce")));
 assert.deepEqual(outreachQualityFailures("At Nine-67, we build custom software with operating teams.\n\nIs order checking already covered?", cold), []);
 assert.deepEqual(outreachQualityFailures("Nine-67 builds custom software for finance teams.\n\nIs order checking already covered?", cold), []);
});

test("AI-first positioning includes the engineers who do the work", () => {
 const context = {requireIntroduction: true, requireAIPositioning: true};
 assert.ok(outreachQualityFailures("Nine-67 builds custom software.\n\nWant help?", context).some(s => s.includes("AI-first")));
 assert.deepEqual(outreachQualityFailures("Nine-67 is an AI-first company. Our forward-deployed engineers work with operating teams. We build custom software with users.\n\nIs there a project you want help delivering?", context), []);
});
