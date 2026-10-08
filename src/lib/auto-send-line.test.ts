import assert from "node:assert/strict";
import test from "node:test";
import { autoSendLine, sentTodayLine, type AutoSendSeat } from "./auto-send-line.ts";

const seat = (extra: Partial<AutoSendSeat> = {}): AutoSendSeat => ({
  autoSend: true, paused: false, pausedReason: null, postalAddressSet: true, skippedToday: false, sentToday: 4, dailyCap: 25,
  sendDay: true, minutesNow: 8 * 60, sendFrom: 9 * 60, sendUntil: 11 * 60 + 30, ...extra,
});

test("before the window on a send day: today's window, and Skip today is offered", () => {
  assert.deepEqual(autoSendLine(seat(), 3), { text: "Auto-send is on. 3 drafts go out today 9:00am to 11:30am, spaced apart.", canSkip: true });
  assert.equal(autoSendLine(seat(), 1).text, "Auto-send is on. 1 draft goes out today 9:00am to 11:30am, spaced apart.");
});

test("during the window it says until when; after it, the next send day with no skip", () => {
  assert.equal(autoSendLine(seat({ minutesNow: 10 * 60 }), 2).text, "Auto-send is on. 2 drafts go out until 11:30am, spaced apart.");
  assert.deepEqual(autoSendLine(seat({ minutesNow: 15 * 60 }), 2), { text: "Auto-send is on. 2 drafts go out on the next send day, 9:00am to 11:30am.", canSkip: false });
  assert.equal(autoSendLine(seat({ sendDay: false }), 2).canSkip, false);
});

test("off, paused, no address, nothing waiting and skipped each say so plainly", () => {
  assert.equal(autoSendLine(seat({ autoSend: false }), 3).text, "Nothing goes out unless you send it.");
  assert.match(autoSendLine(seat({ paused: true, pausedReason: "2 bounces in 48 hours." }), 3).text, /paused \(2 bounces in 48 hours\)\. Resume/);
  assert.match(autoSendLine(seat({ postalAddressSet: false }), 3).text, /postal address/);
  assert.equal(autoSendLine(seat(), 0).text, "Auto-send is on. No drafts are waiting.");
  assert.deepEqual(autoSendLine(seat({ skippedToday: true }), 3), { text: "Auto-send is skipped today. 3 drafts go out on the next send day, 9:00am to 11:30am.", canSkip: false });
});

test("the counter reads like the daily limit", () => {
  assert.equal(sentTodayLine(seat()), "4 of 25 sent today");
});
