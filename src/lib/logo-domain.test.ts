import assert from "node:assert/strict";
import test from "node:test";
import { logoDomain } from "./logo-domain.ts";

test("only bare company domains are looked up", () => {
  assert.equal(logoDomain("https://www.TheBugMan.com/about"), "thebugman.com");
  assert.equal(logoDomain("clegg-pest.co.uk"), "clegg-pest.co.uk");
  for (const bad of ["169.254.169.254", "localhost", "a.com:8080", "-bad.com", "", null, "a..com", "x.y.123"]) assert.equal(logoDomain(bad), null, String(bad));
});
