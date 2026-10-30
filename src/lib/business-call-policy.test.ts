import test from "node:test";
import assert from "node:assert/strict";
import { companyPageTimezone, businessCallEvidenceProblem } from "./business-call-policy.ts";
const now = new Date("2026-10-30T00:00:00Z");
const evidence = { kind: "company", number: "+17175550100", auditedNumber: "+17175550100", lineType: "nonFixedVoip", companySourceVerified: true, sourceUrl: "https://example.test/contact", checkedAt: "2026-10-29T22:00:00Z", timezone: "America/New_York", timezoneSource: "https://example.test/contact" };
test("published business VoIP qualifies without claiming a personal mobile is a company landline", () => {
  assert.equal(businessCallEvidenceProblem(evidence, now), null);
  assert.ok(businessCallEvidenceProblem({ ...evidence, lineType: "mobile" }, now));
  assert.ok(businessCallEvidenceProblem({ ...evidence, companySourceVerified: false }, now));
  assert.ok(businessCallEvidenceProblem({ ...evidence, number: "+17175550199" }, now));
  assert.ok(businessCallEvidenceProblem({ ...evidence, timezone: null }, now));
  assert.ok(businessCallEvidenceProblem({ ...evidence, checkedAt: "2026-08-01" }, now));
});
test("company timezone requires an unambiguous published address", () => {
  assert.equal(companyPageTimezone('<div>York, PA 17404</div>'), "America/New_York");
  assert.equal(companyPageTimezone('{"addressRegion":"NJ"}'), "America/New_York");
  assert.equal(companyPageTimezone('Los Angeles, CA 90001'), "America/Los_Angeles");
  assert.equal(companyPageTimezone('York, PA 17404 Chicago, IL 60601'), null);
  assert.equal(companyPageTimezone('Tennessee, TN 37000'), null);
  assert.equal(companyPageTimezone('No published address'), null);
});

test("split-state offices require a matched city and reject conflicting office timezones", () => {
 assert.equal(companyPageTimezone("Houston, Texas 77001"), "America/Chicago");
 assert.equal(companyPageTimezone("Nashville, TN 37201"), "America/Chicago");
 assert.equal(companyPageTimezone("Groveland, FL 34736"), "America/New_York");
 assert.equal(companyPageTimezone("Houston, TX 77001 El Paso, TX 79901"), null);
 assert.equal(companyPageTimezone('{"addressRegion":"California"}'), "America/Los_Angeles");
});
