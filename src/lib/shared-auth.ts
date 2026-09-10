import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "night_watch_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

function configuredPassword() {
  return process.env.SHARED_PASSWORD || "mintchip";
}

function signingKey() {
  return process.env.AUTH_SECRET || configuredPassword();
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function validSharedPassword(candidate: string) {
  return safeEqual(candidate, configuredPassword());
}

export function sharedSessionToken() {
  return createHmac("sha256", signingKey()).update("night-watch-shared-session-v1").digest("base64url");
}

export function validSharedSession(candidate?: string) {
  return Boolean(candidate && safeEqual(candidate, sharedSessionToken()));
}

export function sharedUser() {
  return { email: process.env.SHARED_OWNER_EMAIL || "josh@nine-67.com" };
}
