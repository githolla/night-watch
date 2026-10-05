import test from "node:test";
import assert from "node:assert/strict";
import { digestEmail, digestIsEmpty, digestSubject, type DigestData } from "./morning-digest.ts";

const quiet = (extra: Partial<DigestData> = {}): DigestData => ({
  seat: "Suuchi", replies: [], meetings: [], todaysList: null, todaysUnsent: 0, firstBatch: null, followupsToday: 0, sentYesterday: 0, bouncedYesterday: 0,
  links: { desk: "https://nw.test/outreach?list=suuchi", today: "https://nw.test/outreach?list=suuchi&batch=today", first: "https://nw.test/outreach?list=suuchi&batch=1", followups: "https://nw.test/followups?owner=suuchi" },
  timeZone: "America/New_York", ...extra,
});

test("a morning with nothing to report sends no email at all", () => {
  assert.equal(digestEmail(quiet()), null);
  assert.equal(digestEmail(quiet({ firstBatch: { sent: 25, total: 25 }, todaysList: 12, todaysUnsent: 0 })), null, "a finished batch and a fully sent list are not news");
  assert.equal(digestIsEmpty(quiet({ sentYesterday: 1 })), false);
});

test("the subject leads with the most important news", () => {
  assert.equal(digestSubject(quiet({ replies: [{ name: "Pat Lee", company: "Acme", kind: "positive" }], sentYesterday: 9 })), "Pat Lee at Acme is interested");
  assert.equal(digestSubject(quiet({ replies: [{ name: "A", company: "X", kind: "neutral" }, { name: "B", company: "Y", kind: "ooo" }] })), "2 new replies");
  assert.match(digestSubject(quiet({ meetings: [{ name: "Pat Lee", company: "Acme", at: "2026-10-06T14:00:00Z" }] })), /^Meeting Tue, Oct 6, 10:00 AM with Pat Lee$/);
  assert.equal(digestSubject(quiet({ todaysList: 12, todaysUnsent: 12, firstBatch: { sent: 3, total: 25 } })), "12 companies ready for you today");
  assert.equal(digestSubject(quiet({ firstBatch: { sent: 7, total: 25 } })), "First 25: 18 left to send");
  assert.equal(digestSubject(quiet({ followupsToday: 1 })), "1 follow-up going out today");
  assert.equal(digestSubject(quiet({ sentYesterday: 1 })), "Yesterday: 1 email sent");
});

test("the email shows only the sections that have something in them, with a link to act on each", () => {
  const email = digestEmail(quiet({ replies: [{ name: "Pat Lee", company: "Acme", kind: "referral" }], firstBatch: { sent: 7, total: 25 }, followupsToday: 2, sentYesterday: 9, bouncedYesterday: 1 }))!;
  assert.match(email.text, /^Good morning, Suuchi\./);
  assert.match(email.text, /A REPLY CAME IN\n- Pat Lee, Acme: pointed you to someone else/);
  assert.match(email.text, /First 25: 7 of 25 sent, 18 to go\./);
  assert.match(email.text, /2 follow-ups will go out on their own today\./);
  assert.match(email.text, /Open your First 25: https:\/\/nw\.test\/outreach\?list=suuchi&batch=1/);
  assert.match(email.text, /You sent 9 emails, and 1 address bounced\. Night Watch will not write to it again\./);
  assert.doesNotMatch(email.text, /MEETING|today's list/);
  assert.doesNotMatch(email.text, /\b0 /, "no zero counts anywhere");
});

test("names from prospects are escaped in the HTML version", () => {
  const email = digestEmail(quiet({ replies: [{ name: "<b>Pat</b>", company: "A&B", kind: "neutral" }] }))!;
  assert.match(email.html, /&lt;b&gt;Pat&lt;\/b&gt;, A&amp;B: replied/);
  assert.doesNotMatch(email.html, /<b>Pat/);
});

test("an untouched batch reads as ready, not as zero sent", () => {
  const email = digestEmail(quiet({ firstBatch: { sent: 0, total: 25 } }))!;
  assert.match(email.text, /First 25: all 25 are drafted and waiting for you\./);
  assert.doesNotMatch(email.text, /\b0 of/);
});

test("on a weekend only news is worth an email, never a reminder", () => {
  assert.equal(digestEmail(quiet({ sendDay: false, firstBatch: { sent: 3, total: 25 }, followupsToday: 2, sentYesterday: 5 })), null);
  assert.ok(digestEmail(quiet({ sendDay: false, replies: [{ name: "Pat Lee", company: "Acme", kind: "neutral" }] })));
});
