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
  const samples = people.filter((person) => person.email && person.email_source !== "pattern").map((person) => ({ name: person.full_name, email: person.email as string }));
  let guess: PatternGuess | null = detectPattern(samples, account.domain);
  if (!guess) guess = guessFromExamples(webExamples, account.domain);
  if (!guess && account.email_pattern) guess = { key: account.email_pattern as PatternKey, confidence: Number(account.pattern_confidence ?? 0.4), matched: 0, samples: 0 };
  if (!guess) return { pattern: null as PatternGuess | null, built: 0 };

  if (guess.key !== account.email_pattern || Number(account.pattern_confidence ?? 0) !== guess.confidence) {
    await db.from("accounts").update({ email_pattern: guess.key, pattern_confidence: guess.confidence }).eq("id", account.id);
  }
  let built = 0;
  for (const person of people) {
    // Fill the blanks, and refresh earlier guesses when the pattern changed.
    if (person.email && person.email_source !== "pattern") continue;
    const email = buildEmail(person.full_name, guess.key, account.domain);
    if (!email || email === person.email) continue;
    const { error } = await db.from("people").update({ email, email_status: "unverified", email_source: "pattern", email_verified_at: null }).eq("id", person.id);
    if (!error) built += 1;
  }
  return { pattern: guess, built };
}
