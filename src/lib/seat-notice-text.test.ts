import assert from "node:assert/strict";
import test from "node:test";
import { headsUpNotice, recapNotice, replyNotice, weeklyNotice } from "./seat-notice-text.ts";

test("the morning heads-up names everyone going out, with a link to keep or skip", () => {
  const notice = headsUpNotice({ first: "Suuchi", going: [{ time: "9:00am", name: "Dana Ortiz", title: "CEO", company: "Acme" }, { time: "9:05am", name: "Lee Park", title: "", company: "Birch & Co" }], window: "9:00am to 11:30am", later: 3, link: "https://app.test/auto-send" });
  assert.equal(notice.subject, "Auto-send today: 2 emails, 9:00am to 11:30am");
  assert.match(notice.text, /- 9:00am: Dana Ortiz, CEO at Acme/);
  assert.match(notice.text, /3 more wait for the next send days/);
  assert.match(notice.text, /Open Auto-send: https:\/\/app\.test\/auto-send/);
  assert.match(notice.html, /Birch &amp; Co/);
  assert.match(notice.html, /<a href="https:\/\/app\.test\/auto-send">Open Auto-send<\/a>/);
});

test("the recap counts what went out and how it is doing", () => {
  const notice = recapNotice({ first: "Suuchi", sent: [{ name: "Dana Ortiz", company: "Acme", outcome: "Sent" }], replies: 0, bounced: 0, cap: 40, link: "https://app.test/drafts/sent" });
  assert.equal(notice.subject, "Auto-send recap: 1 email sent this morning");
  assert.match(notice.text, /So far: 0 replies, 0 bounced\./);
});

test("a reply alert says who, how it reads, and links the call brief", () => {
  const notice = replyNotice({ name: "Dana Ortiz", title: "CEO", company: "Acme", classification: "positive", snippet: "Sure,   let's talk next week.", briefLink: "https://app.test/brief/1", historyLink: "https://app.test/activity" });
  assert.equal(notice.subject, "Reply from Dana Ortiz (Acme): interested");
  assert.match(notice.text, /“Sure, let's talk next week\.”/);
  assert.match(notice.text, /Call brief: https:\/\/app\.test\/brief\/1/);
});

test("the Friday note sums up the week", () => {
  const notice = weeklyNotice({ first: "Suuchi", sent: 30, firsts: 24, followups: 6, replies: 3, interested: 1, bounced: 1, replyRate: 10, bounceRate: 3, topIndustries: [{ label: "Pest control", count: 2 }], interestedPeople: [{ name: "Dana Ortiz", company: "Acme", outcome: "Interested" }], link: "https://app.test/drafts/sent?days=7" });
  assert.equal(notice.subject, "Your week: 30 emails, 3 replies, 1 interested");
  assert.match(notice.text, /- Sent: 30 \(24 first emails, 6 follow-ups\)/);
  assert.match(notice.text, /Most replies came from: Pest control \(2\)\./);
});
