import type { SupabaseClient } from "@supabase/supabase-js";

export function addressCheck(value: unknown): Record<string, unknown> {
  if (typeof value === "string") { try { return addressCheck(JSON.parse(value)); } catch { return {}; } }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function rejectedAddresses(person: { email?: string | null; email_status?: string | null; email_check?: unknown }): string[] {
  const check = addressCheck(person.email_check);
  const addresses = [...(Array.isArray(check.bouncedEmails) ? check.bouncedEmails : []), check.bouncedEmail];
  if (person.email_status === "invalid" || check.level === "undeliverable") addresses.push(check.email ?? person.email);
  return [...new Set(addresses.filter((value): value is string => typeof value === "string" && value.includes("@")).map((value) => value.trim().toLowerCase()))];
}

export function replacementCheck(person: Parameters<typeof rejectedAddresses>[0], check: Record<string, unknown>) {
  const previous = addressCheck(person.email_check);
  return { ...previous, level: "risky", status: "unverified", lastSentEmail: null, lastSentAt: null, likely: false, ...check, bouncedEmails: [...new Set([...rejectedAddresses(person), ...(Array.isArray(check.bouncedEmails) ? check.bouncedEmails.filter((value): value is string => typeof value === "string") : [])])] };
}

/** Negative history belongs to an address across every contact, even after a correction. */
export async function addressRejected(db: SupabaseClient, email: string): Promise<boolean> {
  const address = email.trim().toLowerCase();
  const results = await Promise.all([
    db.from("people").select("id").contains("email_check", { bouncedEmails: [address] }).limit(1),
    db.from("people").select("id").eq("email_check->>bouncedEmail", address).limit(1),
    db.from("people").select("id").ilike("email", address.replace(/[\\%_]/g, (char) => `\\${char}`)).eq("email_status", "invalid").limit(1),
  ]);
  if (results.some((result) => result.error)) throw new Error("Could not check failed-address history. Nothing was sent.");
  return results.some((result) => Boolean(result.data?.length));
}
