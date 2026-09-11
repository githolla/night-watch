import assert from "node:assert/strict";
import test from "node:test";
import { buildBrief, type BriefInput } from "./prospect-brief.ts";

const now = new Date("2026-09-11T12:00:00Z");
const base: BriefInput = {
  name: "Example", tier: "A1", aiSignalOnFile: "cari AI assistant",
  roles: [{ title: "Data Analyst", family: "data_analyst", postedAt: "2026-09-01" }, { title: "Salesforce Administrator", family: "crm_admin", postedAt: "2026-08-20" }],
  posts: [{ author: "Dana Ortiz", title: "CTO", topic: "AI in claims intake", postedAt: "2026-09-02" }],
  signals: [], people: [{ name: "Dana Ortiz", title: "CTO", level: "owner", hasEmail: true, verified: false }, { name: "Chaim Indig", title: "CEO", level: "owner", hasEmail: false, verified: false }],
  drafts: [], touches: [], stage: "untouched", owner: "", notes: "", now,
};

test("a fresh prospect: why, standing, and a next step that names a person", () => {
  const brief = buildBrief(base);
  assert.match(brief.headline, /Good prospect: 2 target roles, 1 AI post/);
  assert.match(brief.why[0], /Hiring 2 roles .*Data Analyst, Salesforce Administrator\) across 2 areas, the newest posted 10 days ago/);
  assert.match(brief.why[1], /Dana Ortiz has posted publicly about AI in claims intake/);
  assert.match(brief.why[2], /cari AI assistant/);
  assert.equal(brief.standing[0], "No one has been contacted yet.");
  assert.match(brief.next, /Write to Dana Ortiz \(CTO\) about the open roles/);
});

test("with a draft waiting, the next step is to send it", () => {
  const brief = buildBrief({ ...base, drafts: [{ person: "Dana Ortiz", status: "new", score: 72 }] });
  assert.match(brief.headline, /Ready to send: 1 draft/);
  assert.match(brief.next, /Send the draft to Dana Ortiz \(score 72\)/);
});

test("after a touch, the brief says when and what to do next", () => {
  const sent = buildBrief({ ...base, stage: "contacted", owner: "Josh", touches: [{ person: "Dana Ortiz", channel: "email", sentAt: "2026-09-03T10:00:00Z", replyAt: null, reply: "none" }] });
  assert.match(sent.standing[0], /Last reach-out: email to Dana Ortiz, 8 days ago/);
  assert.equal(sent.standing[1], "No reply yet.");
  assert.match(sent.standing[2], /Stage: Contacted · owned by Josh/);
  assert.match(sent.next, /No reply in 8 days; send the follow-up to Dana Ortiz/);
  const replied = buildBrief({ ...base, stage: "replied", touches: [{ person: "Dana Ortiz", channel: "email", sentAt: "2026-09-03T10:00:00Z", replyAt: "2026-09-10T10:00:00Z", reply: "positive" }] });
  assert.match(replied.standing[1], /Last reply: Dana Ortiz, positive, yesterday/);
  assert.match(replied.next, /replied \(positive\); answer today/);
});

test("nothing on file is said plainly", () => {
  const brief = buildBrief({ ...base, tier: "A2", aiSignalOnFile: "", roles: [], posts: [], people: [] });
  assert.equal(brief.headline, "Not a prospect yet: nothing found");
  assert.match(brief.why[0], /Nothing found yet/);
  assert.match(brief.next, /Nobody on file yet/);
});
