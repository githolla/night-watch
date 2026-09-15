import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPerson } from "./apollo.ts";

export function apolloConfigured() {
  return Boolean(process.env.APOLLO_API_KEY);
}

type EnrichPerson = { id: string; full_name: string; email: string | null; email_status: string; email_source: string | null; linkedin_url: string | null };

/**
 * Enrich the people already on file for one company with Apollo: fill a
 * verified email and a LinkedIn URL for anyone still missing them. Apollo's
 * people/match returns an address only when Apollo has verified it, so an
 * address written here is safe to send. Runs on demand from the company page
 * so existing contacts are enriched the moment the key is set, without waiting
 * for the next contacts sweep.
 */
export async function enrichAccountPeople(db: SupabaseClient, account: { id: string; domain: string }, limit = 25) {
  if (!apolloConfigured()) return { configured: false, checked: 0, emails: 0, linkedins: 0 };
  const { data } = await db
    .from("people")
    .select("id,full_name,email,email_status,email_source,linkedin_url")
    .eq("account_id", account.id)
    .eq("do_not_contact", false)
    .order("level")
    .limit(limit);
  const people = (data ?? []) as EnrichPerson[];

  let checked = 0;
  let emails = 0;
  let linkedins = 0;
  let departed = 0;
  for (const person of people) {
    // Nothing left to fill for someone with a verified address and a profile URL.
    if (person.email_status === "verified" && person.linkedin_url) continue;
    const match = await matchPerson(person.full_name, account.domain).catch(() => null);
    checked += 1;
    if (!match) continue;
    // Apollo says this person now works somewhere else — they have left. Stop contacting them.
    if (match.stillHere === false) {
      await db.from("people").update({ do_not_contact: true, contact_notes: `Left the company — Apollo shows them at ${match.currentCompany ?? "another company"}.` }).eq("id", person.id);
      departed += 1;
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (match.email && person.email_status !== "verified") {
      patch.email = match.email;
      patch.email_status = "verified";
      patch.email_source = "apollo";
      patch.email_verified_at = new Date().toISOString();
      emails += 1;
    }
    if (match.linkedin_url && !person.linkedin_url) {
      patch.linkedin_url = match.linkedin_url;
      linkedins += 1;
    }
    if (Object.keys(patch).length) await db.from("people").update(patch).eq("id", person.id);
  }
  // Apollo is the source of truth now: drop any leftover blind "best guess" addresses so the page shows
  // a verified email or nothing, never a guess.
  const { data: cleared } = await db.from("people").update({ email: null, email_status: "none", email_source: null, email_verified_at: null }).eq("account_id", account.id).eq("email_source", "guess").select("id");
  return { configured: true, checked, emails, linkedins, departed, cleared: cleared?.length ?? 0 };
}
