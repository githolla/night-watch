import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Salted scrypt hashes, stored as "scrypt$<saltHex>$<hashHex>". No plaintext password ever leaves this file. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  // Never throw: a null/blank hash (an invited account that hasn't set a password yet) or a
  // malformed value must simply fail the check, not crash the whole login request.
  if (!stored || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [scheme, saltHex, hashHex] = parts;
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    if (expected.length === 0) return false;
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
