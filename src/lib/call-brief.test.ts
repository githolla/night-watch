import assert from "node:assert/strict";
import test from "node:test";
import { buildCallBrief, cleanWorkflow, emailFollowupScripts, type BriefInput } from "./call-brief.ts";

test("follow-up scripts use the sender, sent date and email subject without claiming it was read", () => {
  const scripts = emailFollowupScripts({ name: "Lee Edwards", sender: "Suuchi", sentAt: "2026-10-15T13:31:00Z", subject: "Branch reporting at The Greenery", bounced: false });
  for (const text of Object.values(scripts)) {
    assert.match(text, /Suuchi/);
    assert.match(text, /Thursday, Oct 15/);
    assert.match(text, /Branch reporting at The Greenery/);
  }
  assert.match(scripts.opener, /haven't had a chance to read/);
  assert.match(scripts.voicemail, /reply directly to that email/);
});

test("bounced email scripts do not ask the recipient to reply to an undelivered email", () => {
  const scripts = emailFollowupScripts({ name: "Lee Edwards", sender: "Suuchi", sentAt: "2026-10-15T02:00:00Z", subject: "Branch reporting", bounced: true });
  assert.match(scripts.opener, /Wednesday, Oct 14/);
  assert.match(scripts.opener, /bounced/);
  assert.match(scripts.gatekeeper, /confirm their current work email/);
  assert.doesNotMatch(scripts.voicemail, /reply directly/);
});

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  person: { full_name: "Scott Keller", title: "Chief Operating Officer", email: "skeller@nationwidecos.com", linkedin_url: null },
  account: { name: "Nationwide Construction Group", domain: "nationwidecos.com", vertical: "Operating business", employees: null },
  whyNow: "Nationwide Construction Group: Scott Keller, Chief Operating Officer. Reported 2025 revenue: $82M.",
  operatingNeed: "Proposed workflow: turn field progress into a billing-ready record. Internal need and buying intent are not confirmed.",
  roles: [], posts: [], emailSubject: "progress claims at Nationwide Construction Group", emailBody: "Hi Scott,\n\nAn idea.", meetingAt: null, history: [], ...over,
});

test("the research caveat never lands inside a question, and the retired pitch is gone", () => {
  const brief = buildCallBrief(input());
  assert.equal(brief.workflow, "turn field progress into a billing-ready record");
  const text = [...brief.discovery, ...brief.talkingPoints].join(" ");
  assert.doesNotMatch(text, /not confirmed|instead of adding headcount|cost of the headcount/i);
  assert.match(brief.discovery.join(" "), /how your team handles “turn field progress into a billing-ready record” today/);
  assert.ok(!brief.facts.includes("Operating business"));
});

test("a list company's fit reasons, size and limits make the brief", () => {
  const brief = buildCallBrief(input({ research: { sector: "Commercial construction", sizeLabel: "$82M revenue (2025)", workflow: "progress claims", reasons: [{ text: "Hiring a project coordinator", url: "https://jobs.test/1" }], limitations: ["Budget has not been confirmed."] } }));
  assert.deepEqual(brief.facts, ["Commercial construction", "$82M revenue (2025)"]);
  assert.deepEqual(brief.why, [{ text: "Hiring a project coordinator", url: "https://jobs.test/1" }]);
  assert.deepEqual(brief.unknowns, ["Budget has not been confirmed."]);
});

test("the status says where the conversation stands", () => {
  assert.equal(buildCallBrief(input()).status, "Not emailed yet.");
  assert.match(buildCallBrief(input({ history: [{ channel: "email", at: "2026-10-07T14:00:00Z", replied: false }] })).status, /^Emailed once, last on Oct 7\. No reply yet\.$/);
  assert.match(buildCallBrief(input({ history: [{ channel: "email", at: "2026-10-07T14:00:00Z", replied: true, replyClass: "positive" }] })).status, /^Scott replied, interested on Oct 7\.$/);
});

test("cleanWorkflow keeps the idea and drops the caveat", () => {
  assert.equal(cleanWorkflow("Proposed workflow: branch service follow-up. This is an outreach idea, not a confirmed internal problem."), "branch service follow-up");
  assert.equal(cleanWorkflow(null), null);
});

test("cleanTrigger drops the research tail, and anything that only repeats the header", async () => {
  const { cleanTrigger } = await import("./call-brief.ts");
  assert.equal(cleanTrigger("Mainscape: Mark Forsythe, CEO. Proposed area to explore: branch service follow-up."), null);
  assert.equal(cleanTrigger("Nationwide Construction Group: Scott Keller, Chief Operating Officer. Reported 2025 revenue: $82M."), null);
  assert.equal(cleanTrigger("Opened a third branch in Tampa in August 2026."), "Opened a third branch in Tampa in August 2026.");
});
