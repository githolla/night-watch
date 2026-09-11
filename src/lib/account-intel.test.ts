import assert from "node:assert/strict";
import test from "node:test";
import { intelScore } from "./account-intel.ts";

test("a company with nothing scores zero", () => {
  assert.equal(intelScore({ openTargetRoles: 0, targetFamilies: 0, newestRoleAgeDays: null, aiPosts: 0, newestPostAgeDays: null, contacts: 0, verifiedEmails: 0, openCards: 0 }).total, 0);
});

test("fresh roles in two families with a verified contact and a dossier score high", () => {
  const score = intelScore({ openTargetRoles: 3, targetFamilies: 2, newestRoleAgeDays: 3, aiPosts: 1, newestPostAgeDays: 10, contacts: 3, verifiedEmails: 1, openCards: 1 });
  assert.deepEqual(score, { roles: 42, posts: 12, contacts: 15, cards: 10, total: 79 });
});

test("stale evidence is worth less than fresh evidence", () => {
  const fresh = intelScore({ openTargetRoles: 2, targetFamilies: 1, newestRoleAgeDays: 2, aiPosts: 0, newestPostAgeDays: null, contacts: 0, verifiedEmails: 0, openCards: 0 });
  const stale = intelScore({ openTargetRoles: 2, targetFamilies: 1, newestRoleAgeDays: 200, aiPosts: 0, newestPostAgeDays: null, contacts: 0, verifiedEmails: 0, openCards: 0 });
  assert.ok(fresh.total > stale.total);
  assert.equal(stale.roles, 12);
});

test("the total never exceeds 100", () => {
  assert.equal(intelScore({ openTargetRoles: 20, targetFamilies: 6, newestRoleAgeDays: 0, aiPosts: 9, newestPostAgeDays: 0, contacts: 9, verifiedEmails: 4, openCards: 5 }).total, 100);
});
