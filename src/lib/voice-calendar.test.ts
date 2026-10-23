import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { VOICE_BOOKING } from "./voice-booking.ts";
import { queryDb } from "./testing/query-db.ts";

const require = createRequire(import.meta.url);
function calendar() {
  const memory = queryDb({ gmail_connections: [{ owner: "suuchi", email: VOICE_BOOKING.calendar }] });
  const invitations: Array<{ owner: string; options: { summary: string; description: string; attendee: string; bookingKey: string; bufferMinutes: number } }> = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL("./voice-calendar.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date,
    require: (name: string) => {
      if (name === "./supabase/admin.ts") return { admin: () => memory.db };
      if (name === "./gmail.ts") return { ownerAccessToken: async () => "test-token" };
      if (name === "./voice-booking.ts") return { VOICE_BOOKING, voiceSlotAllowed: () => true };
      if (name === "./calendar.ts") return { createInvite: async (owner: string, options: (typeof invitations)[number]["options"]) => { invitations.push({ owner, options }); return { eventId: "test-event" }; } };
      return require(name);
    },
  });
  return { invitations, book: exports.voiceBook as (input: { start: string; email: string; confirmed: boolean; prospectRequested: boolean; internalTest?: boolean }, id: string) => Promise<unknown> };
}

test("live calendar test labels the real event and preserves Suuchi's calendar, buffer and booking key", async () => {
  const h = calendar();
  await h.book({ start: "2035-10-22T14:00:00Z", email: VOICE_BOOKING.calendar, confirmed: true, prospectRequested: false, internalTest: true }, "attempt-1");
  assert.equal(h.invitations.length, 1);
  const invitation = h.invitations[0];
  assert.equal(invitation.owner, "suuchi");
  assert.equal(invitation.options.summary, "TEST: Nine-67 voice booking");
  assert.equal(invitation.options.attendee, VOICE_BOOKING.calendar);
  assert.equal(invitation.options.bufferMinutes, 15);
  assert.match(invitation.options.bookingKey, /voice:attempt-1/);
});

test("live calendar test cannot create an event without agreement or invite an external address", async () => {
  const h = calendar();
  await assert.rejects(h.book({ start: "2035-10-22T14:00:00Z", email: VOICE_BOOKING.calendar, confirmed: false, prospectRequested: false, internalTest: true }, "attempt-1"), /Confirm/);
  await assert.rejects(h.book({ start: "2035-10-22T14:00:00Z", email: "prospect@example.test", confirmed: true, prospectRequested: false, internalTest: true }, "attempt-1"), /cannot invite prospects/);
  assert.equal(h.invitations.length, 0);
});
