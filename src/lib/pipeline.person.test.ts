import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyPersonName } from "./pipeline.ts";

test("real names pass", () => {
  for (const name of ["David Henley", "Chris Young", "Marili Cantu Burba", "Al Green", "Ana Maria de la Cruz"]) {
    assert.equal(isLikelyPersonName(name), true, name);
  }
});

test("service lines and value props are rejected", () => {
  for (const junk of ["Strategic IT Guidance", "Reduced Operational Costs", "Managed Services", "Virtual CIO", "Cloud Solutions", "Access to expertise", "24/7 Support"]) {
    assert.equal(isLikelyPersonName(junk), false, junk);
  }
});

test("single tokens and symbols are rejected", () => {
  assert.equal(isLikelyPersonName("Meriplex"), false);
  assert.equal(isLikelyPersonName("info@meriplex.com"), false);
  assert.equal(isLikelyPersonName(""), false);
});
