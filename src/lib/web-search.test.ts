import assert from "node:assert/strict";
import test from "node:test";
import { keepHit, QUERIES_PER_AGENT, siteOf } from "./web-search.ts";

test("a site-scoped query keeps only hits on that site", () => {
  const query = 'site:linkedin.com/in "Acquia" ("COO" OR "CTO")';
  assert.equal(siteOf(query), "linkedin.com");
  assert.ok(keepHit({ title: "", url: "https://www.linkedin.com/in/dana", snippet: "", date: null }, query));
  assert.ok(!keepHit({ title: "", url: "https://www.acquia.com/team", snippet: "", date: null }, query));
  assert.ok(!keepHit({ title: "", url: "linkedin.com/in/dana", snippet: "", date: null }, query));
  assert.ok(keepHit({ title: "", url: "https://anything.example/x", snippet: "", date: null }, '"Acquia" podcast'));
  assert.equal(siteOf('"Acquia" (site:x.com OR site:twitter.com) AI'), "x.com or twitter.com");
  assert.ok(QUERIES_PER_AGENT <= 5);
});
