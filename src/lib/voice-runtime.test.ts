import { spokenEmailAddress } from "./voice-conversation.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { queryDb } from "./testing/query-db.ts";
import type { VoiceAttempt } from "./voice-runtime.ts";
import { VOICE_BOOKING } from "./voice-booking.ts";
import { operationalVoiceOutcome, validVoiceTimezone, VOICE_PROMPT_VERSION } from "./voice-policy.ts";

const require = createRequire(import.meta.url);
const id = "10000000-0000-4000-8000-000000000001", personId = "10000000-0000-4000-8000-000000000002", slotId = "10000000-0000-4000-8000-000000000003";
const attempt: VoiceAttempt = { id, task_id: null, person_id: personId, owner: "suuchi", mode: "internal", destination: "+17177255050", status: "active", context_snapshot: { contact: { email: "buyer@example.test" } }, eligibility_expires_at: "2035-01-01T00:00:00Z" };
function harness(seed: Parameters<typeof queryDb>[0] = {}) {
  const memory = queryDb(seed);
  let calendarBookings = 0;
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./voice-runtime.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, Date,
    require: (name: string) => {
      if (name === "./voice-conversation.ts") return { spokenEmailAddress };
      if (name === "./supabase/admin.ts") return { admin: () => memory.db };
      if (name === "./voice-calendar.ts") return { voiceAvailability: async () => ({ slots: [] }), voiceBook: async () => { calendarBookings++; return { eventId: "event" }; } };
      if (name === "./voice-booking.ts") return { VOICE_BOOKING };
      if (name === "./voice-policy.ts") return { operationalVoiceOutcome, validVoiceTimezone, VOICE_PROMPT_VERSION };
      return require(name);
    },
  });
  return { ...memory, bookings: () => calendarBookings, tool: exports.executeVoiceTool as (attempt: VoiceAttempt, toolId: string, name: string, args: unknown) => Promise<Record<string, unknown>>, bound: exports.boundVoiceAttempt as (id: string) => Promise<VoiceAttempt> };
}
test("unbound provider calls cannot execute contact actions", async () => {
  await assert.rejects(harness().bound("unregistered"), /no authenticated Nightwatch attempt/);
});
test("rehearsal booking never invites the real prospect", async () => {
  const h = harness({ voice_slots: [{ id: slotId, attempt_id: id, start_at: "2035-10-22T14:00:00Z", end_at: "2035-10-22T14:15:00Z", timezone: "America/New_York", prospect_requested: false, expires_at: "2035-10-21T00:00:00Z" }] });
  const result = await h.tool(attempt, "book-1", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true });
  assert.equal(result.status, "simulated");
  assert.equal(result.attendee_email, "buyer@example.test");
  assert.equal(result.invitation_sent, false);
  assert.equal(h.bookings(), 0);
});
test("slot from another call cannot be booked", async () => {
  const h = harness({ voice_slots: [{ id: slotId, attempt_id: "another-call" }], voice_attempts: [{ id, status: "active" }] });
  await assert.rejects(h.tool(attempt, "book-1", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true }), /slot offered for this call/);
  assert.equal(h.bookings(), 0);
  assert.equal(h.tables.voice_attempts[0].status, "held");
});
test("repeated booking request returns saved result without making another invitation", async () => {
  const h = harness({ voice_actions: [{ id: "action", attempt_id: id, tool_call_id: "meeting-booking", kind: "nightwatch_book", status: "confirmed", result: { status: "confirmed", eventId: "existing" } }] });
  h.fail("voice_actions", "insert");
  const result = await h.tool(attempt, "new-model-tool-id", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true });
  assert.equal(result.eventId, "existing");
  assert.equal(h.bookings(), 0);
});
test("uncertain earlier booking stays pending reconciliation without retrying", async () => {
  const h = harness({ voice_actions: [{ id: "action", attempt_id: id, tool_call_id: "meeting-booking", status: "held", result: null }] });
  h.fail("voice_actions", "insert");
  const result = await h.tool(attempt, "new-model-tool-id", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true });
  assert.equal(result.status, "pending_reconciliation");
  assert.equal(h.bookings(), 0);
});
test("email requests never send mail and bind the recipient to the current call", async () => {
  const h = harness();
  const result = await h.tool(attempt, "email-1", "request_email_followup", { email: "buyer@example.test", confirmed: true, reason: "Requested an example", expressed_words: "Just email me" });
  assert.equal(result.status, "simulated");
  assert.equal(result.sent, false);
  const other = harness({ voice_attempts: [{ id, status: "active" }] });
  await assert.rejects(other.tool(attempt, "email-2", "request_email_followup", { email: "unrelated@example.test", confirmed: true, reason: "Send", expressed_words: "email me" }), /changed recipient/);
});
test("callback requires a real timezone, future time and explicit confirmation", async () => {
  const h = harness();
  await assert.rejects(h.tool(attempt, "callback", "schedule_callback", { start: "2035-10-22T14:00:00Z", timezone: "Eastern", confirmed: true, reason: "Busy", expressed_words: "Call later" }));
  assert.equal(h.tables.voice_actions?.length ?? 0, 0);
});

test("failed live suppression independently holds voice and automatic outreach", async () => {
  const h = harness({ voice_attempts: [{ id, status: "active" }], cards: [{ id: "card", person_id: personId, auto_send_hold: false }], cadences: [{ id: "cadence", person_id: personId, status: "active" }] });
  await assert.rejects(h.tool({ ...attempt, mode: "pilot" }, "suppress-1", "suppress_contact", { scope: "all", reason: "Opt-out", expressed_words: "Remove me entirely" }), /Suppression could not be confirmed/);
  assert.equal(h.tables.voice_suppressions[0].scope, "all");
  assert.equal(h.tables.cards[0].auto_send_hold, true);
  assert.equal(h.tables.cadences[0].status, "paused");
  assert.equal(h.tables.voice_attempts[0].status, "held");
});
test("suppressed live calls cannot book or queue more outreach", async () => {
  const h = harness({ voice_suppressions: [{ person_id: personId, scope: "voice" }] });
  await assert.rejects(h.tool({ ...attempt, mode: "pilot" }, "book", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true }), /suppression request/);
  assert.equal(h.bookings(), 0);
});

test("explicit live calendar rehearsal books only the internal address", async () => {
  const h = harness({ voice_slots: [{ id: slotId, attempt_id: id, start_at: "2035-10-22T14:00:00Z", end_at: "2035-10-22T14:15:00Z", timezone: "America/New_York", prospect_requested: false, expires_at: "2035-10-21T00:00:00Z" }] });
  const result = await h.tool({ ...attempt, context_snapshot: { ...attempt.context_snapshot, live_calendar_test: true } }, "live-test", "nightwatch_book", { slot_id: slotId, email: VOICE_BOOKING.calendar, confirmed: true });
  assert.equal(result.status, "confirmed");
  assert.equal(result.internal_test, true);
  assert.equal(result.attendee_email, VOICE_BOOKING.calendar);
  assert.equal(h.bookings(), 1);
  assert.equal(h.tables.cadences?.length ?? 0, 0);
  h.fail("voice_actions", "insert");
  const repeated = await h.tool({ ...attempt, context_snapshot: { live_calendar_test: true } }, "retry-live-test", "nightwatch_book", { slot_id: slotId, email: VOICE_BOOKING.calendar, confirmed: true });
  assert.equal(repeated.status, "confirmed");
  assert.equal(h.bookings(), 1);
});

test("live calendar rehearsal cannot invite the roleplay prospect", async () => {
  const h = harness({ voice_slots: [{ id: slotId, attempt_id: id, start_at: "2035-10-22T14:00:00Z", end_at: "2035-10-22T14:15:00Z", timezone: "America/New_York", prospect_requested: false, expires_at: "2035-10-21T00:00:00Z" }], voice_attempts: [{ id, status: "active" }] });
  await assert.rejects(h.tool({ ...attempt, context_snapshot: { live_calendar_test: true } }, "live-test", "nightwatch_book", { slot_id: slotId, email: "buyer@example.test", confirmed: true }), /only use operations@nine-67.com/);
  assert.equal(h.bookings(), 0);
});
