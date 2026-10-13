import test from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph.ts";
import { records } from "./fixtures.ts";
import { companyStory, dateLabel, journeyLayout, recordedDate, timelineNodes } from "./presentation.ts";
test("addresses retain their real contact, verification date and safe source without rewriting send history", () => {
  const graph = buildGraph({ ...records, people: [{ ...records.people[0], email_verified_at: "2026-10-13T13:00:00Z", email_source: "https://northline.example/team", created_at: "2026-10-10T12:00:00Z" }] });
  const address = graph.nodes.find((node) => node.id === "email:p1")!;
  assert.equal(address.label, records.people[0].email); assert.equal(address.at, "2026-10-13T13:00:00Z"); assert.equal(address.sourceUrl, "https://northline.example/team");
  assert.ok(graph.edges.some((edge) => edge.from === "person:p1" && edge.to === address.id));
  assert.ok(graph.edges.some((edge) => edge.from === address.id && edge.to === "source:https://northline.example/team"));
  assert.equal(graph.edges.some((edge) => edge.from === address.id && edge.to.startsWith("outreach:")), false);
  assert.match(dateLabel(address), /^Verified Oct 13/);
});
test("missing verification dates and source publication dates remain unknown", () => {
  const graph = buildGraph(records);
  assert.equal(graph.nodes.find((node) => node.id === "email:p1")?.at, null);
  assert.equal(graph.nodes.find((node) => node.kind === "source")?.at, null);
  assert.equal(recordedDate(null), "Date not recorded"); assert.equal(recordedDate("invalid"), "Date not recorded");
  assert.equal(recordedDate("2026-10-01"), "Oct 1, 2026");
});
test("company summaries preserve dated events and count shared evidence for each connected company", () => {
  const companies = [...records.companies, { ...records.companies[0], id: "other", domain: "other.example" }];
  const graph = buildGraph({ ...records, companies, signals: [...records.signals, { ...records.signals[0], id: "other-signal", account_id: "other", person_id: null }] });
  const first = companyStory(graph, "co"), other = companyStory(graph, "other");
  assert.equal(first.contacts.length, 3); assert.equal(first.addresses.length, 3); assert.equal(first.sent.length, 2); assert.equal(first.replies.length, 1);
  assert.ok(other.sources.some((node) => node.id === "source:https://northline.example/news/regions"));
  const events = timelineNodes(graph); assert.equal(events[0].kind, "reply");
  assert.ok(events.every((node) => node.at));
});
test("journey cards have unique positions and current address rows follow their actual contact", () => {
  const graph = buildGraph(records), points = journeyLayout(graph);
  assert.equal(Object.keys(points).length, graph.nodes.length);
  assert.equal(new Set(Object.values(points).map((point) => `${point.x},${point.y}`)).size, graph.nodes.length);
  for (const edge of graph.edges.filter((edge) => edge.label === "has current address")) assert.equal(points[edge.from].y, points[edge.to].y);
  assert.ok(points["outreach:t1"].x > points["person:p1"].x);
});
