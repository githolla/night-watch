import assert from "node:assert/strict";
import test from "node:test";
import { blockKind, blockedGroups } from "./autosend-blocked.ts";

test("held emails group by reason, address problems first, then the biggest groups", () => {
  const emails = [
    { id: "a", reason: "the buyer's identity is not confirmed" },
    { id: "b", reason: "no usable email address" },
    { id: "c", reason: "No usable email address" },
    { id: "d", reason: "the buyer's identity is not confirmed" },
    { id: "e", reason: "the buyer's identity is not confirmed" },
    { id: "f", reason: null },
  ];
  const groups = blockedGroups(emails);
  assert.deepEqual(groups.map((group) => [group.reason, group.kind, group.emails.map((email) => email.id).join("")]), [
    ["No usable email address", "address", "bc"],
    ["The buyer's identity is not confirmed", "identity", "ade"],
    ["Held by the morning run", "other", "f"],
  ]);
});

test("the kind of block decides the fix", () => {
  assert.equal(blockKind("address not confirmed"), "address");
  assert.equal(blockKind("the buyer's identity is not confirmed"), "identity");
  assert.equal(blockKind("company paused"), "other");
});
