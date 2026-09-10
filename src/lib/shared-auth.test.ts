import assert from "node:assert/strict";
import test from "node:test";
import { sharedSessionToken, validSharedPassword, validSharedSession } from "./shared-auth.ts";

test("the requested shared password creates a valid signed session", () => {
  const previousPassword = process.env.SHARED_PASSWORD;
  const previousSecret = process.env.AUTH_SECRET;
  process.env.SHARED_PASSWORD = "mintchip";
  process.env.AUTH_SECRET = "test-only-cookie-secret";

  assert.equal(validSharedPassword("mintchip"), true);
  assert.equal(validSharedPassword("wrong"), false);
  assert.equal(validSharedSession(sharedSessionToken()), true);
  assert.equal(validSharedSession("forged-session"), false);

  if (previousPassword === undefined) delete process.env.SHARED_PASSWORD;
  else process.env.SHARED_PASSWORD = previousPassword;
  if (previousSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = previousSecret;
});
