import test from "node:test";
import assert from "node:assert/strict";
import { loadRelationshipGraph } from "./load.ts";
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
