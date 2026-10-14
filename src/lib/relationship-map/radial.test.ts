import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.ts";
import { records } from "./fixtures.ts";
import { radialCamera, radialFacets, radialLayout, matchesLeadLens, ringRadius } from "./radial.ts";
import { segmentGraph, ALL_SEGMENTS } from "./segments.ts";
test("all company hubs stay inside the circle while categorized records occupy outer rings", () => {
  const companies = Array.from({ length: 60 }, (_, index) => ({ ...records.companies[0], id: `co-${index}`, domain: `company-${index}.example` }));
  const graph = buildGraph({ ...records, companies, people: companies.map((company, index) => ({ ...records.people[0], id: `p-${index}`, account_id: company.id })) });
  const points = radialLayout(graph);
  for (const node of graph.nodes) { const radius = Math.hypot(points[node.id].x, points[node.id].y); assert.ok(node.kind === "company" ? radius <= 620 : radius >= 850 - 1e-6); }
  assert.equal(new Set(Object.values(points).map((point) => `${point.x},${point.y}`)).size, graph.nodes.length);
  assert.deepEqual(radialLayout(graph), points); assert.ok(ringRadius(points) >= 960);
});
test("single-company views remain circular and never use a square lane layout", () => {
  const graph = buildGraph(records), points = radialLayout(graph);
  assert.deepEqual(points["company:co"], { x: 0, y: -0 });
  assert.ok(graph.nodes.filter((node) => node.kind !== "company").every((node) => Math.hypot(points[node.id].x, points[node.id].y) >= 850 - 1e-6));
});
test("date ring nodes group real record dates and preserve source publication uncertainty", () => {
  const graph = buildGraph(records);
  assert.ok(graph.nodes.some((node) => node.id === "date:2026-10-12"));
  assert.ok(graph.edges.some((edge) => edge.from === "outreach:t1" && edge.to === "date:2026-10-12" && edge.label === "recorded on"));
  assert.ok(graph.nodes.filter((node) => node.kind === "source").every((node) => node.at === null));
  const selected = segmentGraph(graph, records.companies, ALL_SEGMENTS);
  assert.ok(selected.nodes.some((node) => node.kind === "date"));
});
test("lead shortcuts use actual send and reply records without inferring deliverability", () => {
  const graph = buildGraph(records);
  assert.equal(matchesLeadLens(graph, "co", "unsent"), false);
  assert.equal(matchesLeadLens(graph, "co", "bounces"), true);
  assert.equal(matchesLeadLens(graph, "co", "replies"), true);
  assert.equal(matchesLeadLens(graph, "co", "email-review"), true);
  assert.equal(matchesLeadLens(graph, "co", "missing-email"), false);
  const missing = buildGraph({ ...records, people: [{ ...records.people[0], email: null }] });
  assert.equal(matchesLeadLens(missing, "co", "missing-email"), true);
});

test("reset camera centers and fully frames the outer circle, including its labels", () => {
  const points = radialLayout(buildGraph(records)), radius = ringRadius(points), camera = radialCamera(points);
  assert.equal(camera.x, 800); assert.equal(camera.y, 580);
  assert.ok(camera.y - (radius + 50) * camera.scale > 0);
  assert.ok(camera.y + (radius + 50) * camera.scale < 1160);
});

test("clickable facet counts use target metadata and preserve unknown revenue", () => {
  const companies = [{ ...records.companies[0], revenueUsdM: 75 }, { ...records.companies[0], id: "other", domain: "other.example", revenueUsdM: null }];
  const graph = buildGraph({ ...records, companies });
  const facets = radialFacets(graph, "revenue", companies);
  assert.equal(facets.find((facet) => facet.value === "50to100")?.count, 1);
  assert.equal(facets.find((facet) => facet.value === "unknown")?.count, 1);
  assert.equal(facets.reduce((sum, facet) => sum + facet.count, 0), 2);
});

test("malformed calendar dates do not create fabricated date-ring nodes", () => {
  const graph = buildGraph({ ...records, people: [], drafts: [], touches: [], signals: [{ ...records.signals[0], observed_at: "2026-02-30" }], jobs: [], posts: [], discoveries: [] });
  assert.equal(graph.nodes.some((node) => node.kind === "date"), false);
});
