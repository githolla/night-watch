import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph, connectionPath, layoutGraph, neighborhood } from "./graph.ts";
import { filterGraph, placeLabels, zoomCamera, DEFAULT_CAMERA } from "./view.ts";
import { records } from "./fixtures.ts";
test("relationships are grounded in recorded foreign keys and deduplicate source URLs", () => {
  const graph = buildGraph(records);
  assert.equal(graph.nodes.filter((node) => node.kind === "company").length, 1);
  assert.equal(graph.nodes.filter((node) => node.kind === "source").length, 5);
  assert.ok(graph.edges.some((edge) => edge.from === "signal:s1" && edge.to === "draft:d1"));
  assert.ok(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.from) && graph.nodes.some((node) => node.id === edge.to)));
});
test("unsent cards do not generate delivery or reply records", () => {
  const graph = buildGraph({ ...records, touches: [...records.touches, { ...records.touches[0], id: "pending", card_id: "d2", sent_at: null }] });
  assert.equal(graph.nodes.some((node) => node.id === "outreach:pending"), false);
  assert.equal(graph.nodes.filter((node) => node.kind === "outreach").length, 2);
});
test("unconfirmed discoveries and cross-company people are not joined by name guessing", () => {
  const graph = buildGraph({ ...records, people: [...records.people, { ...records.people[0], id: "foreign", account_id: "other" }], discoveries: [{ ...records.discoveries[0], company_confirmed: false }] });
  assert.equal(graph.nodes.some((node) => node.id === "person:foreign"), false);
  assert.equal(graph.nodes.some((node) => node.kind === "discovery"), false);
});
test("bounces, suppressed contacts and replies retain their real states", () => {
  const graph = buildGraph(records);
  assert.equal(graph.nodes.find((node) => node.id === "person:p3")?.status, "do not contact");
  assert.equal(graph.nodes.find((node) => node.id === "outreach:t2")?.status, "bounced");
  assert.equal(graph.nodes.find((node) => node.id === "reply:t1")?.status, "positive");
  assert.ok(graph.edges.some((edge) => edge.from === "outreach:t2" && edge.to === "bounce:t2"));
});
test("paths trace real edges and never invent shortcuts", () => {
  const graph = buildGraph(records); const path = connectionPath(graph, "company:co", "reply:t1");
  assert.equal(path[0], "company:co"); assert.equal(path.at(-1), "reply:t1");
  for (let i = 1; i < path.length; i++) assert.ok(graph.edges.some((edge) => (edge.from === path[i - 1] && edge.to === path[i]) || (edge.to === path[i - 1] && edge.from === path[i])));
  assert.deepEqual(connectionPath(graph, "company:co", "missing"), []);
  assert.ok(neighborhood(graph, "person:p1").ids.has("draft:d1"));
});
test("filters preserve the company and remove dangling edges", () => {
  const graph = buildGraph(records); const filtered = filterGraph(graph, new Set(["person"]), "Jamie", null);
  assert.ok(filtered.nodes.some((node) => node.kind === "company"));
  assert.ok(filtered.nodes.every((node) => ["company", "person"].includes(node.kind)));
  assert.ok(filtered.edges.every((edge) => filtered.nodes.some((node) => node.id === edge.from) && filtered.nodes.some((node) => node.id === edge.to)));
});
test("layout is deterministic and dense contacts have distinct positions", () => {
  const graph = buildGraph(records); assert.deepEqual(layoutGraph(graph), layoutGraph(graph));
  const dense = buildGraph({ ...records, people: Array.from({ length: 40 }, (_, index) => ({ ...records.people[0], id: `contact-${index}` })) });
  const points = layoutGraph(dense); assert.equal(new Set(dense.nodes.filter((node) => node.kind === "person").map((node) => JSON.stringify(points[node.id]))).size, 40);
});
test("zoom anchors stay fixed and scale remains bounded", () => {
  const anchor = { x: 400, y: 300 }; const zoomed = zoomCamera(DEFAULT_CAMERA, 2, anchor);
  assert.equal((anchor.x - DEFAULT_CAMERA.x) / DEFAULT_CAMERA.scale, (anchor.x - zoomed.x) / zoomed.scale);
  assert.equal(zoomCamera(DEFAULT_CAMERA, 100, anchor).scale, 3.5); assert.equal(zoomCamera(DEFAULT_CAMERA, 0.001, anchor).scale, 0.35);
});
test("unsafe source links are not exposed as clickable evidence", () => {
  const graph = buildGraph({ ...records, signals: [{ ...records.signals[0], source_url: "javascript:alert(1)" }] });
  assert.equal(graph.nodes.find((node) => node.id === "signal:s1")?.sourceUrl, null);
});
test("labels avoid overlapping each other in the representative company layout", () => {
  const graph = buildGraph(records); const points = layoutGraph(graph);
  const nodes = graph.nodes.filter((node) => node.kind !== "source" && node.kind !== "company");
  const layout = placeLabels(nodes, points);
  const boxes = nodes.map((node) => ({ x: points[node.id].x + layout[node.id].x, y: points[node.id].y + layout[node.id].y, width: layout[node.id].width, height: 34 }));
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const first = boxes[a], second = boxes[b];
    assert.ok(first.x + first.width <= second.x || second.x + second.width <= first.x || first.y + first.height <= second.y || second.y + second.height <= first.y);
  }
});
