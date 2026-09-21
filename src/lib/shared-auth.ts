import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "night_watch_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const inProduction = () => process.env.NODE_ENV === "production";

// The shared bootstrap password. No hardcoded default in production: if SHARED_PASSWORD is unset there,
// shared-password login simply doesn't work (returns null → every candidate fails) rather than falling
// back to a guessable literal. Per-user accounts are unaffected. A dev-only default keeps local login easy.
function configuredPassword(): string | null {
  const set = process.env.SHARED_PASSWORD?.trim();
  if (set) return set;
  return inProduction() ? null : "dev-only-password";
}

// The HMAC key for the legacy shared-session cookie. A dedicated AUTH_SECRET first, then the (also secret)
// shared password — never a hardcoded literal. Null in production when neither is set, which disables the
// shared session entirely so a fixed, forgeable token can never be issued or accepted.
function signingKey(): string | null {
  const secret = process.env.AUTH_SECRET?.trim() || process.env.SHARED_PASSWORD?.trim();
  if (secret) return secret;
  return inProduction() ? null : "dev-only-signing-key";
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validSharedPassword(candidate: string) {
  const password = configuredPassword();
  return password !== null && safeEqual(candidate, password);
}

export function sharedSessionToken(): string | null {
  const key = signingKey();
  return key === null ? null : createHmac("sha256", key).update("night-watch-shared-session-v1").digest("base64url");
}

export function validSharedSession(candidate?: string | null) {
  const token = sharedSessionToken();
  return Boolean(candidate && token && safeEqual(candidate, token));
}

export function sharedUser() {
  return { email: process.env.SHARED_OWNER_EMAIL || "josh@nine-67.com" };
}
