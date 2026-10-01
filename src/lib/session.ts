import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "./crypto.ts";
import { sharedPasswordFingerprint } from "./shared-auth.ts";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type Session = { uid: string | null; boot: boolean; jti: string | null; sv: number; exp: number };

/**
 * A tamper-proof (AES-GCM) session cookie carrying either a user id or a bootstrap-admin flag, plus expiry.
 * `jti` lets logout revoke this one token; `sv` is the user's session_version, bumped on a password change
 * to end every older session; a bootstrap session carries the shared password's fingerprint instead.
 */
export function issueSession(uid: string | null, boot = false, sessionVersion = 0): string {
  return encrypt(JSON.stringify({
    uid, boot, exp: Date.now() + SESSION_MAX_AGE * 1000, jti: randomBytes(12).toString("base64url"), sv: sessionVersion,
    ...(boot ? { pw: sharedPasswordFingerprint() } : {}),
  }));
}

export function readSession(token?: string): Session | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(decrypt(token)) as { uid?: string | null; boot?: boolean; exp?: number; jti?: string; sv?: number; pw?: string | null };
    if (!payload.exp || payload.exp < Date.now()) return null;
    // A shared-password session dies with the password it was issued under (and older ones without the
    // fingerprint must sign in again once).
    if (payload.boot && (!payload.pw || payload.pw !== sharedPasswordFingerprint())) return null;
    return { uid: payload.uid ?? null, boot: Boolean(payload.boot), jti: payload.jti ?? null, sv: Number(payload.sv ?? 0), exp: payload.exp };
  } catch {
    return null;
  }
}
