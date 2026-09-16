import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "./passwords.ts";

test("a correct password verifies, a wrong one does not", () => {
  const stored = hashPassword("night-watch-42!");
  assert.ok(stored.startsWith("scrypt$"));
  assert.equal(verifyPassword("night-watch-42!", stored), true);
  assert.equal(verifyPassword("night-watch-43!", stored), false);
});

test("hashes are salted (two hashes of the same password differ)", () => {
  assert.notEqual(hashPassword("same"), hashPassword("same"));
});

test("a malformed stored hash never verifies", () => {
  assert.equal(verifyPassword("x", "not-a-hash"), false);
  assert.equal(verifyPassword("x", ""), false);
});
