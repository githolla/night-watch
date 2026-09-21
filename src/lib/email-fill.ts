import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmail, detectPattern, guessFromExamples, type PatternGuess, type PatternKey } from "./email-pattern.ts";

type PersonRow = { id: string; full_name: string; email: string | null; email_status: string; email_source: string | null };

/**
 * Learn the company's address format from any address already on file
 * (or from addresses seen on the web), store it on the account, and build an
 * address for everyone there who has none. Built addresses are unverified:
 * they show on the company page for a person to check, and the send guard
 * keeps them out of automatic sends.
 */
export async function fillEmailsFromPattern(db: SupabaseClient, account: { id: string; domain: string; email_pattern?: string | null; pattern_confidence?: number | null }, webExamples: string[] = []) {
  const { data } = await db.from("people").select("id,full_name,email,email_status,email_source").eq("account_id", account.id).eq("do_not_contact", false);
  const people = (data ?? []) as PersonRow[];
  // Learn the format only from real addresses. A "pattern"-built or blind "guess" address is our own
  // construction, not evidence — feeding it back in would let a low-confidence guess masquerade as the
  // account's confirmed pattern.
  const samples = people.filter((person) => person.email && person.email_source !== "pattern" && person.email_source !== "guess").map((person) => ({ name: person.full_name, email: person.email as string }));
  let guess: PatternGuess | null = detectPattern(samples, account.domain);
  if (!guess) guess = guessFromExamples(webExamples, account.domain);
  if (!guess && account.email_pattern) guess = { key: account.email_pattern as PatternKey, confidence: Number(account.pattern_confidence ?? 0.4), matched: 0, samples: 0 };

  // When a paid verifier (Apollo or Hunter) is connected, do NOT stamp unverified addresses on people at all —
  // not a blind first.last guess, and not a pattern-built one. Apollo returns verified emails and Hunter finds
  // and verifies them, so an unverified guess only clutters the list with "best guess" rows. Still learn and
  // store the format for reference, and clear any earlier guesses so the page shows a real address or nothing.
  const hasVerifier = Boolean(process.env.APOLLO_API_KEY || process.env.HUNTER_API_KEY);
  if (hasVerifier) {
    if (guess && (guess.key !== account.email_pattern || Number(account.pattern_confidence ?? 0) !== guess.confidence)) {
      await db.from("accounts").update({ email_pattern: guess.key, pattern_confidence: guess.confidence }).eq("id", account.id);
    }
    const { data: cleared } = await db.from("people").update({ email: null, email_status: "none", email_source: null, email_verified_at: null }).eq("account_id", account.id).eq("email_source", "guess").select("id");
    return { pattern: guess, built: 0, cleared: cleared?.length ?? 0 };
  }

  // Last resort (no verifier): no address and no example anywhere. Fall back to the most common corporate
  // format (first.last@) as a low-confidence *guess*, marked as a guess and never used for an automatic send.
  const blind = !guess;
  if (!guess) guess = { key: "first.last", confidence: 0.15, matched: 0, samples: 0 };

  // Only remember a format we actually learned; a blind guess must not masquerade as the account's pattern.
  if (!blind && (guess.key !== account.email_pattern || Number(account.pattern_confidence ?? 0) !== guess.confidence)) {
    await db.from("accounts").update({ email_pattern: guess.key, pattern_confidence: guess.confidence }).eq("id", account.id);
  }
  const source = blind ? "guess" : "pattern";
  let built = 0;
  for (const person of people) {
    // Fill the blanks, and refresh earlier built addresses when the pattern changed.
    if (person.email && person.email_source !== "pattern" && person.email_source !== "guess") continue;
    const email = buildEmail(person.full_name, guess.key, account.domain);
    if (!email || email === person.email) continue;
    const { error } = await db.from("people").update({ email, email_status: "unverified", email_source: source, email_verified_at: null }).eq("id", person.id);
    if (!error) built += 1;
  }
  return { pattern: blind ? null : guess, built };
}
