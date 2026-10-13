import test from "node:test";
import assert from "node:assert/strict";
import { canvasPoint, centeredCamera, minimapGeometry, orderedCompanies } from "./navigation.ts";
test("pointer mapping accounts for SVG letterboxing in wide and tall canvases", () => {
  assert.deepEqual(canvasPoint({ x: 800, y: 580 }, { left: 0, top: 0, width: 1600, height: 1160 }), { x: 800, y: 580 });
  assert.deepEqual(canvasPoint({ x: 1100, y: 680 }, { left: 100, top: 100, width: 2000, height: 1160 }), { x: 800, y: 580 });
  assert.deepEqual(canvasPoint({ x: 500, y: 650 }, { left: 100, top: 100, width: 800, height: 1100 }), { x: 800, y: 580 });
});
test("centering and minimap transforms round-trip world positions", () => {
  const point = { x: 3000, y: -1800 }, camera = centeredCamera(point, 0.8);
  assert.equal(point.x * camera.scale + camera.x, 800); assert.equal(point.y * camera.scale + camera.y, 580);
  const mini = minimapGeometry({ a: point, b: { x: -3000, y: 1800 } });
  assert.ok(point.x * mini.scale + mini.x > 0 && point.x * mini.scale + mini.x < 200);
  assert.ok(point.y * mini.scale + mini.y > 0 && point.y * mini.scale + mini.y < 120);
  assert.equal((point.x * mini.scale + mini.x - mini.x) / mini.scale, point.x);
});

test("company stepping follows actual list positions with today's targets first", () => {
  const company = { id: "base", name: "Base", domain: "base.example", status: "active" };
  const rows = [{ ...company, id: "next", outreachList: "Next 25", listPosition: 1 }, { ...company, id: "second", outreachList: "First 25", listPosition: 2 }, { ...company, id: "first", outreachList: "First 25", listPosition: 1 }, { ...company, id: "today", outreachList: "Today's 10", listPosition: 1 }];
  assert.deepEqual(orderedCompanies(rows).map((company) => company.id), ["today", "first", "second", "next"]);
  assert.equal(rows[0].id, "next");
});
