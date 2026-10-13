import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { CompanyOverview, RelationshipTimeline } from "../../components/RelationshipViews.tsx";
import * as graph from "./graph.ts";
import * as view from "./view.ts";
import * as presentation from "./presentation.ts";
import { records } from "./fixtures.ts";
const require = createRequire(import.meta.url);
function components() {
  const exports: { CompanyOverview?: typeof CompanyOverview; RelationshipTimeline?: typeof RelationshipTimeline } = {};
  const mocks: Record<string, unknown> = { "@/lib/relationship-map/graph": graph, "@/lib/relationship-map/view": view, "@/lib/relationship-map/presentation": presentation };
  runInNewContext(ts.transpileModule(readFileSync(new URL("../../components/RelationshipViews.tsx", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, { exports, URL, Set, Map, Date, require: (name: string) => name in mocks ? mocks[name] : require(name) });
  return exports;
}
test("company overview presents names, actual addresses, dates, source links and recorded sent totals", () => {
  const html = renderToStaticMarkup(React.createElement(components().CompanyOverview!, { graph: graph.buildGraph(records), companies: records.companies, selected: null, ready: true, onSelect: () => {}, onOpen: () => {} }));
  assert.ok(html.includes("Northline Services")); assert.ok(html.includes("Jamie Carter")); assert.ok(html.includes("jamie@northline.example"));
  assert.ok(html.includes("Sources")); assert.ok(html.includes("Sent")); assert.ok(html.includes("Replied Oct 13, 2026")); assert.ok(html.includes("Explore graph"));
  assert.ok(html.includes('href="https://northline.example/news/regions"'));
});
test("a contact without an address never inherits another contact's email in the company card", () => {
  const data = graph.buildGraph({ ...records, people: [{ ...records.people[0], email: null }, records.people[1]] });
  const html = renderToStaticMarkup(React.createElement(components().CompanyOverview!, { graph: data, companies: records.companies, selected: null, ready: true, onSelect: () => {}, onOpen: () => {} }));
  assert.ok(html.includes("Jamie Carter")); assert.ok(html.includes("No current address for this contact"));
  assert.equal(html.includes("morgan@northline.example"), false);
});
test("timeline renders recorded timestamps with year and timezone, with latest activity first", () => {
  const html = renderToStaticMarkup(React.createElement(components().RelationshipTimeline!, { graph: graph.buildGraph(records), selected: null, onSelect: () => {} }));
  assert.ok(html.includes("Oct 13, 2026")); assert.ok(html.includes("ET")); assert.ok(html.indexOf("Replies") < html.indexOf("Reach-outs"));
  assert.equal(html.includes("source publication date"), false);
});
