import test from "node:test";
import assert from "node:assert/strict";
import { ALL_SEGMENTS, matchesSegment, revenueBand, segmentGraph } from "./segments.ts";
import { buildGraph, layoutGraph } from "./graph.ts";
import { fitCamera } from "./view.ts";
import { records } from "./fixtures.ts";
test("revenue bands use exclusive upper boundaries and unknown stays unknown", () => {
  const company = records.companies[0];
  assert.equal(revenueBand(company), "unknown");
  for (const [revenueUsdM, band] of [[9, "under10"], [10, "10to50"], [50, "50to100"], [100, "100to1000"], [1000, "over1000"]] as const) assert.equal(revenueBand({ ...company, revenueUsdM }), band);
  assert.equal(matchesSegment({ ...company, vertical: "Manufacturing", revenueUsdM: 75 }, { ...ALL_SEGMENTS, industry: "Manufacturing", revenue: "50to100" }), true);
  assert.equal(matchesSegment(company, { ...ALL_SEGMENTS, revenue: "50to100" }), false);
});
test("segmenting removes other companies while preserving shared evidence and exact edges", () => {
  const companies = [{ ...records.companies[0], vertical: "Manufacturing" }, { ...records.companies[0], id: "other", domain: "other.com", vertical: "Retail" }];
  const graph = buildGraph({ ...records, companies });
  const selected = segmentGraph(graph, companies, { ...ALL_SEGMENTS, industry: "Manufacturing" });
  assert.ok(selected.nodes.some((node) => node.kind === "source"));
  assert.equal(selected.nodes.some((node) => node.companyId === "other"), false);
  assert.ok(selected.edges.every((edge) => selected.nodes.some((node) => node.id === edge.from) && selected.nodes.some((node) => node.id === edge.to)));
  assert.deepEqual(segmentGraph(graph, companies, ALL_SEGMENTS).nodes, graph.nodes);
});
test("each company's contacts orbit their own company and the whole portfolio fits", () => {
  const companies = [records.companies[0], { ...records.companies[0], id: "other", domain: "other.com" }];
  const graph = buildGraph({ ...records, companies, people: [...records.people, { ...records.people[0], id: "p-other", account_id: "other" }] });
  const points = layoutGraph(graph);
  assert.ok(Math.hypot(points["person:p-other"].x - points["company:other"].x, points["person:p-other"].y - points["company:other"].y) < 400);
  const camera = fitCamera(points);
  for (const point of Object.values(points)) { assert.ok(point.x * camera.scale + camera.x > 0 && point.x * camera.scale + camera.x < 1600); assert.ok(point.y * camera.scale + camera.y > 0 && point.y * camera.scale + camera.y < 1160); }
});
