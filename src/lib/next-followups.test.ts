import assert from "node:assert/strict";
import test from "node:test";
import { followupState } from "./next-followups.ts";

const NOW = Date.parse("2026-10-13T15:00:00Z");
const step = (extra: Partial<{ channel: string; kind: string; status: string; scheduled_at: string; error: string | null; sent_at: string | null }> = {}) => ({ channel: "email", kind: "automatic", status: "pending", scheduled_at: "2026-10-14T15:00:00Z", error: null, sent_at: null, ...extra });

test("an automatic email to a confirmed address goes by itself and needs nobody before it is due", () => {
  assert.deepEqual(followupState(step(), true, NOW), { auto: true, needsYou: false });
});

test("an unconfirmed address waits for a person once it comes due", () => {
  assert.deepEqual(followupState(step(), false, NOW), { auto: false, needsYou: false });
  assert.deepEqual(followupState(step({ scheduled_at: "2026-10-13T14:00:00Z" }), false, NOW), { auto: false, needsYou: true });
});

test("an automatic step only needs a person once it is well overdue, or failed, or marked ready", () => {
  assert.equal(followupState(step({ scheduled_at: "2026-10-13T14:50:00Z" }), true, NOW).needsYou, false, "the cron has not had its turn yet");
  assert.equal(followupState(step({ scheduled_at: "2026-10-13T13:00:00Z" }), true, NOW).needsYou, true);
  assert.equal(followupState(step({ status: "failed" }), true, NOW).needsYou, true);
  assert.equal(followupState(step({ status: "ready" }), true, NOW).needsYou, true);
});

test("LinkedIn steps are never automatic; a step already being delivered needs nobody", () => {
  assert.equal(followupState(step({ channel: "linkedin_message", kind: "review" }), true, NOW).auto, false);
  assert.equal(followupState(step({ status: "failed", sent_at: "2026-10-13T14:00:00Z" }), true, NOW).needsYou, false);
});
