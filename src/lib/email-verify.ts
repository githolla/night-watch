import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether a built or unverified address actually delivers. Night Watch
 * builds addresses from the company's format; without a check they stay
 * "unverified" and the send guard keeps them out of automatic sends. With
 * HUNTER_API_KEY set, each built address is checked once against Hunter's
 * verifier and, when a person has no address at all, Hunter's finder is
 * asked for one. Both are best effort: a failure leaves the row as it was.
 */
export type VerifyResult = { status: "verified" | "catch_all" | "unverified" | "invalid" | "unknown"; score: number | null };

export function verifierConfigured() {
  return Boolean(process.env.HUNTER_API_KEY);
}

type HunterVerify = { data?: { status?: string; result?: string; score?: number } };
type HunterFind = { data?: { email?: string | null; score?: number; verification?: { status?: string } } };

async function hunter<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://api.hunter.io/v2/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", process.env.HUNTER_API_KEY as string);
  const response = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (response.status === 222) return (await response.json()) as T; // Hunter: verification still running; the body carries what it has.
  if (!response.ok) throw new Error(`Hunter ${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

function fromHunterStatus(status: string | undefined, score: number | undefined): VerifyResult {
  const value = typeof score === "number" ? score : null;
  switch (status) {
    case "valid": return { status: "verified", score: value };
    case "accept_all": return { status: "catch_all", score: value };
    case "invalid": case "disposable": return { status: "invalid", score: value };
    default: return { status: "unknown", score: value };
  }
}

/** Check one address. */
export async function verifyEmail(email: string): Promise<VerifyResult> {
  if (!verifierConfigured()) return { status: "unknown", score: null };
  const json = await hunter<HunterVerify>("email-verifier", { email });
  return fromHunterStatus(json.data?.status, json.data?.score);
}

/** Find an address for a person at a domain. Returns null when the finder has nothing confident. */
export async function findEmail(fullName: string, domain: string): Promise<{ email: string; result: VerifyResult } | null> {
  if (!verifierConfigured()) return null;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const json = await hunter<HunterFind>("email-finder", { domain, first_name: parts[0], last_name: parts[parts.length - 1] });
  const email = json.data?.email?.toLowerCase();
  if (!email) return null;
  const result = fromHunterStatus(json.data?.verification?.status, json.data?.score);
  // The finder's own score stands in when it did not verify: 70+ is Hunter's "confident" band.
  if (result.status === "unknown" && (json.data?.score ?? 0) >= 70) return { email, result: { status: "unverified", score: json.data?.score ?? null } };
  return { email, result };
}

type PersonRow = { id: string; full_name: string; email: string | null; email_status: string; email_source: string | null; email_verified_at: string | null };

/**
 * Verify every built or unverified address at the company that has not been
 * checked, and look one up for anyone without an address. Capped per call so
 * one company cannot spend the month's allowance.
 */
export async function verifyAccountEmails(db: SupabaseClient, account: { id: string; domain: string }, limit = 12): Promise<{ checked: number; verified: number; invalid: number; found: number }> {
  const out = { checked: 0, verified: 0, invalid: 0, found: 0 };
  if (!verifierConfigured()) return out;
  const { data } = await db.from("people").select("id,full_name,email,email_status,email_source,email_verified_at").eq("account_id", account.id).eq("do_not_contact", false).order("level").limit(60);
  const people = (data ?? []) as PersonRow[];
  let budget = limit;
  for (const person of people) {
    if (budget <= 0) break;
    try {
      if (person.email && person.email_status !== "verified" && !person.email_verified_at) {
        budget -= 1;
        const result = await verifyEmail(person.email);
        out.checked += 1;
        const patch: Record<string, unknown> = { email_verified_at: new Date().toISOString() };
        if (result.status === "verified") { patch.email_status = "verified"; out.verified += 1; }
        else if (result.status === "catch_all") patch.email_status = "catch_all";
        else if (result.status === "invalid") {
          // A wrong guess is worse than no address: clear it so the person is looked up instead.
          out.invalid += 1;
          patch.email = null; patch.email_status = "none"; patch.email_source = null; patch.email_verified_at = null;
        }
        await db.from("people").update(patch).eq("id", person.id);
      } else if (!person.email) {
        budget -= 1;
        const found = await findEmail(person.full_name, account.domain);
        if (!found || found.result.status === "invalid") continue;
        out.found += 1;
        await db.from("people").update({
          email: found.email,
          email_status: found.result.status === "verified" ? "verified" : found.result.status === "catch_all" ? "catch_all" : "unverified",
          email_source: "hunter",
          email_verified_at: found.result.status === "verified" || found.result.status === "catch_all" ? new Date().toISOString() : null,
        }).eq("id", person.id);
      }
    } catch (error) {
      console.warn(`[night-watch] email check failed for ${person.full_name} at ${account.domain}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return out;
}
