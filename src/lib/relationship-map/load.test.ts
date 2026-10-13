import test from "node:test";
import assert from "node:assert/strict";
import { loadRelationshipGraph, loadPortfolioGraph, readPages } from "./load.ts";
import { queryDb } from "../testing/query-db.ts";
import { records } from "./fixtures.ts";
function memory() { return queryDb({ accounts: records.companies, people: records.people, cards: records.drafts, touches: records.touches, signals: records.signals, job_postings: records.jobs, public_posts: records.posts, discovery_opportunities: records.discoveries }); }
test("company graph reads stored records without mutations, enrichment or sending", async () => {
  const h = memory(); const graph = await loadRelationshipGraph(h.db, records.companies[0].domain);
  assert.ok(graph); assert.ok(graph.nodes.some((node) => node.kind === "reply"));
  assert.ok(h.log.every((entry) => entry.op === "select")); assert.equal(graph.companyId, "co");
});
test("an unavailable optional source layer is reported rather than invented as complete", async () => {
  const h = memory(); h.fail("discovery_opportunities", "select");
  const graph = await loadRelationshipGraph(h.db, records.companies[0].domain);
  assert.ok(graph); assert.match(graph.warnings.join(" "), /Confirmed discoveries/); assert.equal(graph.nodes.some((node) => node.kind === "discovery"), false); assert.ok(graph.nodes.some((node) => node.kind === "person"));
});
test("unknown companies do not produce a synthetic graph", async () => {
  assert.equal(await loadRelationshipGraph(memory().db, "missing.example"), null);
});
test("missing delivery columns do not fabricate successful sends", async () => {
  const h = memory(); h.fail("touches", "select");
  const graph = await loadRelationshipGraph(h.db, records.companies[0].domain);
  assert.ok(graph); assert.equal(graph.nodes.some((node) => node.kind === "outreach"), false); assert.match(graph.warnings.join(" "), /Delivery and reply history/);
});

test("portfolio loads every page and every company relationship without a company cap", async () => {
  const companies = Array.from({ length: 503 }, (_, index) => ({ ...records.companies[0], id: `co-${index}`, domain: `company-${index}.com` }));
  const people = companies.map((company, index) => ({ ...records.people[0], id: `p-${index}`, account_id: company.id }));
  const h = queryDb({ accounts: companies, people });
  const portfolio = await loadPortfolioGraph(h.db);
  assert.equal(portfolio.companies.length, 503);
  assert.equal(portfolio.graph.nodes.filter((node) => node.kind === "company").length, 503);
  assert.equal(portfolio.graph.nodes.filter((node) => node.kind === "person").length, 503);
  assert.equal(portfolio.graph.warnings.length, 0);
  assert.ok(h.log.every((entry) => entry.op === "select"));
});
test("a later failed page is never presented as a complete layer", async () => {
  let reads = 0;
  await assert.rejects(readPages(async () => ++reads === 1 ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null } : { data: null, error: new Error("Unavailable") }));
  const h = memory(); h.fail("people", "select");
  const portfolio = await loadPortfolioGraph(h.db);
  assert.match(portfolio.graph.warnings.join(" "), /people.*incomplete/);
});
