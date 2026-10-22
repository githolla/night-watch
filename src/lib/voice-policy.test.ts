import test from "node:test";
import assert from "node:assert/strict";
import { emailSentSpoken, nextVoiceCallAt, operationalVoiceOutcome, voiceEligibility, type VoiceEligibility } from "./voice-policy.ts";

const now = new Date("2026-10-22T15:00:00Z");
const eligible: VoiceEligibility = { sentAt: "2026-10-21T14:00:00Z", hasBody: true, hasBounce: false, hasReply: false, hasMeeting: false, suppressed: false, activeCall: false, timezone: "America/New_York", generatedAt: "2026-10-22T14:59:00Z", expiresAt: "2026-10-22T15:04:00Z", eligibilityApproved: true };
test("voice timing uses recipient's local date across timezones and daylight savings", () => {
  assert.equal(emailSentSpoken("2026-10-22T02:00:00Z", "America/Los_Angeles", now), "yesterday");
  assert.equal(emailSentSpoken("2026-10-22T02:00:00Z", "Asia/Tokyo", new Date("2026-10-22T14:00:00Z")), "earlier today");
  assert.equal(emailSentSpoken(null, "America/New_York", now), "recently");
  assert.equal(emailSentSpoken(eligible.sentAt, null, now), "recently");
  assert.equal(nextVoiceCallAt("2026-10-30T16:00:00Z", "America/New_York"), "2026-11-02T15:00:00.000Z");
  assert.equal(nextVoiceCallAt("2026-10-24T02:00:00Z", "America/Los_Angeles"), "2026-10-26T17:00:00.000Z");
  assert.equal(nextVoiceCallAt("2026-10-23T16:00:00Z", "America/New_York", 2), "2026-10-27T14:00:00.000Z");
});
test("every required eligibility failure holds a call", () => {
  assert.equal(voiceEligibility(eligible, now).allowed, true);
  const changes: Array<Partial<VoiceEligibility>> = [{ sentAt: null }, { hasBody: false }, { hasBounce: true }, { hasReply: true }, { hasMeeting: true }, { suppressed: true }, { activeCall: true }, { timezone: null }, { timezone: "invalid" }, { eligibilityApproved: false }, { expiresAt: "2026-10-22T14:00:00Z" }, { generatedAt: "2030-01-01T00:00:00Z" }];
  for (const change of changes) assert.equal(voiceEligibility({ ...eligible, ...change }, now).allowed, false, JSON.stringify(change));
  assert.equal(voiceEligibility(eligible, now, 2).allowed, false);
  assert.equal(voiceEligibility({ ...eligible, expiresAt: "2030-01-01T00:00:00Z" }, new Date("2026-10-24T15:00:00Z")).allowed, false);
  assert.equal(voiceEligibility({ ...eligible, timezone: "America/Los_Angeles" }, now).allowed, false);
});
const analysis = { outcome: "meeting_booked", reached_intended_person: true, workflow_discussed: "Quoting", pain_point: null, interest_level: "high", meeting_requested: true, callback_requested: false, email_followup_requested: false, do_not_contact_requested: false, referral_name: null, human_followup_reason: null, summary: "Meeting booked" };
test("model summary cannot establish a booking, suppression or callback", () => {
  const facts = { meetingConfirmed: false, suppressed: false, callbackSaved: false, emailQueued: false };
  assert.deepEqual(operationalVoiceOutcome(analysis, facts), { outcome: null, reviewRequired: true });
  assert.equal(operationalVoiceOutcome(analysis, { ...facts, meetingConfirmed: true }).outcome, "meeting_booked");
  assert.equal(operationalVoiceOutcome({ ...analysis, outcome: "do_not_contact" }, facts).outcome, null);
  assert.equal(operationalVoiceOutcome({ ...analysis, outcome: "callback_requested" }, facts).outcome, null);
  assert.equal(operationalVoiceOutcome({ ...analysis, outcome: "interested_followup" }, { ...facts, suppressed: true }).outcome, "do_not_contact");
  assert.deepEqual(operationalVoiceOutcome({}, facts), { outcome: null, reviewRequired: true });
});
