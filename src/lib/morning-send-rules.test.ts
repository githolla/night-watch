import assert from "node:assert/strict";
import test from "node:test";
import { localParts } from "./local-time.ts";
import {
  announceText, automaticContentProblem, autoSendBlocker, bounceBrake, bounceReason, followupHoldReason, identityHoldReason, isSendDay, listAlertText, MORNING, morningWindowProblems, paceForRun, pauseText, rowForecast, summaryText,
} from "./morning-send-rules.ts";

const withEnv = (values: Record<string, string | undefined>, run: () => void) => {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { run(); } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
};

test("the bounce brake fires on two recent bounces or a rate over 5% across at least 10 first emails", () => {
  assert.equal(bounceBrake(12, 5, 0), true);
  assert.equal(bounceBrake(12, 0, 0), false);
  assert.equal(bounceBrake(9, 1, 0), false, "below the minimum");
  assert.equal(bounceBrake(20, 1, 0), false, "exactly 5% is allowed");
  assert.equal(bounceBrake(8, 2, 2), true, "two bounces in 48 hours pause even with few sends");
  assert.equal(bounceBrake(40, 2, 1), false, "one recent bounce and a 5% rate do not");
  assert.match(bounceReason(8, 2, 2), /48 hours.*automatic follow-ups are paused/);
  assert.doesNotMatch(bounceReason(12, 5, 0), /today/);
});

test("pacing spreads the list, never sends more than two a run, and stops at the end of the window", () => {
  assert.equal(paceForRun(12, 11 * 60 + 20), 2);
  assert.equal(paceForRun(12, 9 * 60), 1);
  assert.equal(paceForRun(0, 10 * 60), 0);
  assert.equal(paceForRun(12, MORNING.sendUntil), 0);
  assert.equal(paceForRun(12, MORNING.sendUntil + 10), 0);
});

test("the weekday comes with the local date", () => {
  assert.equal(localParts(new Date("2026-10-03T13:30:00Z"), "America/New_York").weekday, "Sat");
  assert.equal(localParts(new Date("2026-10-05T13:30:00Z"), "America/New_York").weekday, "Mon");
});

test("lists send Monday to Friday and never on a skip date", () => {
  withEnv({ SEND_DAYS: undefined, SKIP_DATES: "2026-11-26, 2026-12-25" }, () => {
    assert.equal(isSendDay("Sat"), false);
    assert.equal(isSendDay("Sun"), false);
    assert.equal(isSendDay("Mon"), true);
    assert.equal(isSendDay("Thu", "2026-11-26"), false, "Thanksgiving");
    assert.equal(isSendDay("Thu", "2026-11-19"), true);
  });
  withEnv({ SEND_DAYS: "Tue,Wed" }, () => {
    assert.equal(isSendDay("Mon"), false);
    assert.equal(isSendDay("Tue"), true);
  });
});

test("a one-day skip blocks only that date", () => {
  const seat = { autoSend: true, paused: false, postalAddress: "1 Main St" };
  assert.equal(autoSendBlocker({ ...seat, skipOn: "2026-10-05", today: "2026-10-05" }), "auto-send is skipped for today");
  assert.equal(autoSendBlocker({ ...seat, skipOn: "2026-10-04", today: "2026-10-05" }), null);
  assert.equal(autoSendBlocker({ ...seat, skipOn: null, today: "2026-10-05" }), null);
});

test("automatic follow-ups hold for a paused seat or a missing postal address, not for auto-send being off", () => {
  assert.match(String(followupHoldReason({ paused: true, pausedReason: "2 first emails bounced.", postalAddress: "1 Main St" })), /paused.*2 first emails bounced/);
  assert.match(String(followupHoldReason({ paused: false, postalAddress: "  " })), /postal address/);
  assert.equal(followupHoldReason({ paused: false, postalAddress: "1 Main St" }), null);
});

test("a row with an identity hold or an unconfirmed address is forecast as held", () => {
  assert.deepEqual(rowForecast({ emailCheck: { level: "deliverable", reason: "Hunter verified this address." } }), { send: true, reason: null });
  assert.deepEqual(rowForecast({ emailCheck: { level: "risky", reason: "Not confirmed." } }), { send: false, reason: "Not confirmed." });
  assert.deepEqual(rowForecast({ emailCheck: { level: "deliverable" }, identityHold: "buyer left the company" }), { send: false, reason: "buyer left the company" });
  assert.equal(identityHoldReason({ identityHold: true }), "the buyer's identity is not confirmed");
  assert.equal(identityHoldReason({ identityHold: { reason: "title does not match" } }), "title does not match");
  assert.equal(identityHoldReason({}), null);
});

test("the morning window is checked against the cron hours", () => {
  const { announceAt, sendFrom } = MORNING;
  assert.deepEqual(morningWindowProblems("America/New_York", announceAt, sendFrom, 11 * 60 + 30, new Date("2026-07-15T12:00:00Z")), [], "EDT");
  assert.deepEqual(morningWindowProblems("America/New_York", announceAt, sendFrom, 11 * 60 + 30, new Date("2026-01-15T12:00:00Z")), [], "EST");
  assert.ok(morningWindowProblems("America/Los_Angeles", announceAt, sendFrom, 11 * 60 + 30, new Date("2026-07-15T12:00:00Z")).length > 0);
  const lateJanuary = morningWindowProblems("America/New_York", announceAt, sendFrom, 13 * 60, new Date("2026-01-15T12:00:00Z"));
  assert.ok(lateJanuary.some((problem) => /until 13:00 \(18:00 UTC\)/.test(problem)), lateJanuary.join("; "));
  assert.deepEqual(morningWindowProblems("America/New_York", announceAt, sendFrom, 13 * 60, new Date("2026-07-15T12:00:00Z")), [], "13:00 EDT is 17:00 UTC");
});

test("morning messages name companies and reasons, and never claim edited cards are held", () => {
  const announce = announceText({ seat: "Suuchi", rows: [{ company: "Acme", send: true, reason: null }, { company: "Beta", send: false, reason: "Not confirmed." }], blocker: null, size: 12, link: "https://app/outreach" });
  assert.match(announce, /1 of 2 companies for Suuchi are expected to auto-send/);
  assert.match(announce, /1\. Acme: expected to send/);
  assert.match(announce, /2\. Beta: held, Not confirmed\./);
  assert.match(announce, /short: 2 of 12/);
  const summary = summaryText({ seat: "Josh", sent: 3, held: [{ company: "Beta", reason: "Not confirmed." }], kept: 1, link: "https://app/outreach" });
  assert.match(summary, /3 sent automatically, 1 kept by you to send by hand, 1 left on the list/);
  assert.match(summary, /- Beta: Not confirmed\./);
  for (const text of [announce, summary]) assert.doesNotMatch(text, /edited after the hold/);
  assert.match(listAlertText({ seat: "Josh", status: "failed", rows: 0, size: 12, errors: ["no buyer found (4)"], link: "x" }), /No list for Josh today: the nightly build failed.*no buyer found/);
  const pause = pauseText({ seat: "Josh", reason: "2 first emails bounced in the last 48 hours.", bounced: [{ email: "bad@acme.com", company: "Acme" }], unsent: 7, listLink: "https://app/outreach", settingsLink: "https://app/settings" });
  assert.match(pause, /bad@acme\.com \(Acme\)/);
  assert.match(pause, /7 of today's list still unsent/);
  assert.match(pause, /https:\/\/app\/settings/);
  assert.doesNotMatch(pause, /delivery-recovery/);
  for (const text of [announce, summary, pause]) assert.doesNotMatch(text, /[—–]/);
});

test("auto-sent content may carry one link and no images", () => {
  const gift = "https://night-watch-snowy.vercel.app/gift/0123456789abcdef0123456789abcdef";
  assert.equal(automaticContentProblem(`Read it: ${gift}`, `<a href="${gift}">Read your one-page brief</a>`), null, "the same link in both parts counts once");
  assert.match(String(automaticContentProblem("Hello", `<img src="https://cdn.example.com/logo.png">`)), /image/);
  assert.match(String(automaticContentProblem("Hello", `<p>Hi</p><img src="cid:logo">`)), /image/);
  assert.match(String(automaticContentProblem(`See ${gift}`, `<a href="https://nine-67.com">site</a>`)), /2 links/);
});
