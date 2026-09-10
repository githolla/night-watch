import assert from "node:assert/strict";
import test from "node:test";
import { classifyTitle, operatingNeedFor } from "./classify.ts";

const cases: Array<[string, ReturnType<typeof classifyTitle>]> = [
  ["Senior Machine Learning Engineer", "ai_ml"],
  ["AI Product Manager", "ai_ml"],
  ["Revenue Operations Manager", "revops"],
  ["Sales Ops Analyst", "revops"],
  ["Salesforce Administrator", "crm_admin"],
  ["HubSpot CRM Specialist", "crm_admin"],
  ["Systems Integration Engineer", "systems_integration"],
  ["NetSuite Administrator", "systems_integration"],
  ["Business Process Automation Lead", "automation"],
  ["Continuous Improvement Manager", "automation"],
  ["Sales Development Representative", "sdr"],
  ["Inside Sales Associate", "sdr"],
  ["Customer Support Specialist", "support"],
  ["Call Center Representative", "support"],
  ["Customer Service Representative", "support"],
  ["Data Analyst II", "data_analyst"],
  ["Financial Planning Analyst", "data_analyst"],
  ["Business Intelligence Developer", "data_analyst"],
  ["Operations Analyst", "ops_analyst"],
  ["Business Analyst", "ops_analyst"],
  ["CDL Class A Driver", null],
  ["Registered Nurse", null],
  ["Warehouse Associate", null],
  ["Tax Senior Associate", null],
  ["Litigation Attorney", null],
  ["Store Manager", null],
  ["Security Analyst", null],
];

for (const [title, expected] of cases) {
  test(`classifies "${title}" as ${expected}`, () => assert.equal(classifyTitle(title), expected));
}

test("operating need names the work, not the hire", () => {
  const one = operatingNeedFor([{ title: "Data Analyst", family: "data_analyst" }]);
  assert.match(one, /hiring a Data Analyst/);
  assert.match(one, /instead of the hire/);
  const many = operatingNeedFor([
    { title: "Customer Support Specialist", family: "support" },
    { title: "Customer Service Representative", family: "support" },
    { title: "Salesforce Administrator", family: "crm_admin" },
    { title: "Forklift Operator", family: null },
  ]);
  assert.match(many, /hiring 3 roles/);
  assert.match(many, /instead of adding headcount/);
  assert.equal(operatingNeedFor([{ title: "Driver", family: null }]), "");
});
