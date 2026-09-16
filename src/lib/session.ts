import { encrypt, decrypt } from "./crypto.ts";

export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/** A tamper-proof (AES-GCM) session cookie carrying either a user id or a bootstrap-admin flag, plus expiry. */
export function issueSession(uid: string | null, boot = false): string {
  return encrypt(JSON.stringify({ uid, boot, exp: Date.now() + SESSION_MAX_AGE * 1000 }));
}

export function readSession(token?: string): { uid: string | null; boot: boolean } | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(decrypt(token)) as { uid?: string | null; boot?: boolean; exp?: number };
    if (!payload.exp || payload.exp < Date.now()) return null;
    return { uid: payload.uid ?? null, boot: Boolean(payload.boot) };
  } catch {
    return null;
  }
}
