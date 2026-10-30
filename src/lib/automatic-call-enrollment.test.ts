import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { queryDb } from "./testing/query-db.ts";
import { businessCallEvidenceProblem, companyLocationTimezone } from "./business-call-policy.ts";
import { normalizeVoicePhone } from "./voice-phone-audit.ts";

function harness(enabled = true, lineType = "nonFixedVoip") {
  const tasks = ["josh", "suuchi"].map((owner, index) => ({ id: `task-${owner}`, personId: `person-${owner}`, name: "Sam Smith", domain: "example.test", plan: { status: "pending", phone: { number: `+1717555010${index}`, kind: "company" }, phoneAudit: { number: `+1717555010${index}`, lineType, companySourceVerified: true, sourceUrl: "https://example.test/contact", timezone: "America/New_York", timezoneSource: "https://example.test/contact", checkedAt: new Date().toISOString() } } }));
  const h = queryDb({ voice_pilot_config: [{ id: true, enabled, starts_at: "2026-01-01T00:00:00Z", ends_at: "2099-01-01T00:00:00Z", booking_test_passed: true, voicemail_test_passed: true, optout_test_passed: true }], people: tasks.map(task => ({ id: task.personId, email_check: {} })), voice_eligibility: [] });
  const exports: Record<string, unknown> = {};
  const mocks: Record<string, unknown> = { zod: { z }, "./call-tasks.ts": { loadCallTasks: async () => tasks }, "./business-call-policy.ts": { businessCallEvidenceProblem, companyLocationTimezone }, "./prospect-import.ts": { importedProspects: [] }, "./voice-phone-audit.ts": { normalizeVoicePhone } };
  runInNewContext(ts.transpileModule(readFileSync(new URL("./automatic-call-enrollment.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, require: (name: string) => { if (name in mocks) return mocks[name]; throw new Error(name); } });
  return { ...h, run: () => (exports.enrollBusinessCalls as (db: typeof h.db) => Promise<{ enrolled: number }>)(h.db) };
}
test("enabled company-number policy enrolls both owners once with actual line evidence", async () => {
  const h = harness();
  assert.equal((await h.run()).enrolled, 2);
  assert.equal(h.tables.voice_eligibility.length, 2);
  assert.match(String(h.tables.voice_eligibility[0].approval_evidence), /nonFixedVoip/);
  assert.match(String(h.tables.voice_eligibility[0].approval_evidence), /No personal mobile or written-consent claim/);
  assert.equal((await h.run()).enrolled, 0);
});
test("disabled policy and mobile numbers cannot enroll automatically", async () => {
  const disabled = harness(false);
  assert.equal((await disabled.run()).enrolled, 0);
  const mobile = harness(true, "mobile");
  assert.equal((await mobile.run()).enrolled, 0);
});
