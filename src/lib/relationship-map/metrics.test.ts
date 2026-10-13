import test from "node:test";
import assert from "node:assert/strict";
import { loadPortfolioMetrics } from "./metrics.ts";
import { queryDb } from "../testing/query-db.ts";
import { focusForOwner } from "../focus-data.ts";
import { records } from "./fixtures.ts";
test("aggregate totals retain all records but never count unsent drafts as outreach", async () => {
  const h = queryDb({ accounts: records.companies, people: records.people, cards: records.drafts, touches: [...records.touches, { ...records.touches[0], id: "unsent", sent_at: null }], signals: records.signals, job_postings: Array.from({ length: 1003 }, (_, index) => ({ ...records.jobs[0], id: `job-${index}` })), public_posts: records.posts, discovery_opportunities: records.discoveries });
  const result = await loadPortfolioMetrics(h.db);
  assert.equal(result.companies.co.job, 1003);
  assert.equal(result.companies.co.outreach, records.touches.filter((touch) => touch.sent_at).length);
  assert.equal(result.companies.co.reply, records.touches.filter((touch) => touch.sent_at && touch.reply_at).length);
  assert.ok(h.log.every((entry) => entry.op === "select"));
});
test("failed aggregate tables produce a coverage notice", async () => {
  const h = queryDb({ accounts: records.companies }); h.fail("job_postings", "select");
  assert.match((await loadPortfolioMetrics(h.db)).warnings.join(" "), /job_postings/);
});

test("target list metrics never include contacts or hiring records from outside the lists", async () => {
  const row = focusForOwner("josh", 1)[0];
  const h = queryDb({ accounts: [{ ...records.companies[0], domain: row.domain }, { ...records.companies[0], id: "outside", domain: "outside.com" }], people: [...records.people, { ...records.people[0], id: "outside-person", account_id: "outside" }], job_postings: [...records.jobs, { ...records.jobs[0], id: "outside-job", account_id: "outside" }] });
  const result = await loadPortfolioMetrics(h.db, "josh");
  assert.equal(result.companies.outside, undefined); assert.equal(result.companies.co.person, records.people.length); assert.equal(result.companies.co.job, records.jobs.length);
});
