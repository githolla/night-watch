import test from "node:test";
import assert from "node:assert/strict";
import { voiceVoicemail } from "./voice-voicemail.ts";

test("voicemail connects the exact sent subject to a reply and callback without a host name", () => {
  const message = voiceVoicemail({ firstName: "Morgan", sentSpoken: "Friday", subject: "one AI project: shipping handoffs" });
  assert.match(message, /Hi Morgan/);
  assert.match(message, /shipping handoffs, sent Friday/);
  assert.match(message, /reply to that email/);
  assert.match(message, /two zero one, five eight one, four three zero nine/);
  assert.match(message, /reply stop/);
  assert.doesNotMatch(message, /Suuchi|operations@|CEO|read our|received our/);
});
test("voicemail omits unknown subject and date instead of inventing either", () => {
  const message = voiceVoicemail();
  assert.match(message, /following up on our email\./);
  assert.doesNotMatch(message, /yesterday|Friday|undefined|null/);
});
