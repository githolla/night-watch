import assert from "node:assert/strict";
import test from "node:test";
import { analysisRolesToPostings, channelFor, DRAFT_FIT_FLOOR, draftBreakdown, pickWhoFirst, scoreOfBreakdown, type DraftCandidate } from "./analysis-draft.ts";
import { CARD_THRESHOLD } from "./scoring.ts";

const person = (over: Partial<DraftCandidate>): DraftCandidate => ({ id: "x", full_name: "Someone Else", title: "Analyst", level: "adjacent", email: null, email_status: "none", linkedin_url: null, path_score: 0, ...over });

test("the person the synthesizer named is matched by full name, then loosely", () => {
  const people = [person({ id: "a", full_name: "Dana Ortiz", level: "owner" }), person({ id: "b", full_name: "Priya Raman", level: "influencer" })];
  assert.equal(pickWhoFirst("dana ortiz", people).person?.id, "a");
  assert.equal(pickWhoFirst("D. Ortiz", people).person?.id, "a");
  assert.equal(pickWhoFirst("Dana M. Ortiz", people).how, "named");
});

test("with nobody named, the most senior reachable person wins, and a poster beats silence", () => {
  const people = [
    person({ id: "quiet-owner", full_name: "Quiet Owner", level: "owner" }),
    person({ id: "posting-vp", full_name: "Posting VP", level: "influencer", linkedin_url: "https://linkedin.com/in/p" }),
    person({ id: "verified-analyst", full_name: "Verified Analyst", level: "adjacent", email: "v@x.com", email_status: "verified" }),
  ];
  assert.equal(pickWhoFirst("", people).person?.id, "quiet-owner");
  assert.equal(pickWhoFirst("", people, ["Posting VP"]).person?.id, "posting-vp");
  assert.equal(pickWhoFirst("Nobody Here", []).how, "none");
});

test("an analysis draft clears the card threshold at the fit floor and decays like any other", () => {
  const today = new Date().toISOString().slice(0, 10);
  const atFloor = draftBreakdown(DRAFT_FIT_FLOOR, 0, today);
  assert.ok(scoreOfBreakdown(atFloor) >= CARD_THRESHOLD, `score ${scoreOfBreakdown(atFloor)} at fit ${DRAFT_FIT_FLOOR}`);
  assert.equal(draftBreakdown(100, 10, today).signal_strength, 40);
  assert.equal(draftBreakdown(100, 10, today).relationship_path, 10);
  assert.equal(draftBreakdown(70, null, "2020-01-01").recency, 0);
  assert.equal(draftBreakdown(140, 0, today).signal_strength, 40);
});

test("roles from job boards become posting rows only with a real URL, classified by title", () => {
  const rows = analysisRolesToPostings([
    { title: "Senior Data Engineer", url: "https://www.linkedin.com/jobs/view/123#top", posted_at: "2026-09-01T00:00:00Z", why: "Builds the pipelines" },
    { title: "Line Cook", url: "https://indeed.com/job/1", posted_at: null, why: "" },
    { title: "RPA Developer", url: null, posted_at: null, why: "" },
    { title: "Senior Data Engineer", url: "https://www.linkedin.com/jobs/view/123", posted_at: null, why: "" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].family, "data_analyst");
  assert.equal(rows[0].posted_at, "2026-09-01");
  assert.equal(rows[0].url, "https://www.linkedin.com/jobs/view/123");
  assert.equal(rows[0].description, "Builds the pipelines");
  assert.equal(rows[1].family, null);
});

test("the channel follows what is on file, not what the model proposed", () => {
  assert.equal(channelFor(person({ email: null }), false), "linkedin_only");
  assert.equal(channelFor(person({ email: "a@b.com", email_status: "unverified" }), false), "linkedin_first");
  assert.equal(channelFor(person({ email: "a@b.com", email_status: "verified" }), false), "email_first");
  assert.equal(channelFor(person({ email: "a@b.com", email_status: "verified" }), true), "linkedin_first");
  assert.equal(channelFor(person({ email: "a@b.com", email_status: "verified", path_score: 10 }), false), "intro");
});
