/**
 * Delivery failures arrive in the same Gmail thread as the original email, from an address that is not
 * ours, so the reply rule alone counted them as prospect replies: the cadence stopped and the card was
 * marked "replied" for an address that never received anything. Recognise them by sender and subject.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { markBounced, type RecipientPerson } from "./recipient-verification.ts";

type Header = { name: string; value: string };

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|bounces?|mailerdaemon)@/i;
const BOUNCE_NAME = /\b(mail delivery (subsystem|system)|mail delivery failure|postmaster)\b/i;
const BOUNCE_SUBJECT = /\b(delivery status notification|undeliverable|undelivered mail|delivery (has )?failed|mail delivery failed|returned mail|failure notice|message not delivered|address not found)\b/i;

function header(headers: Header[], name: string) {
  return headers.find((h) => h.name.toLowerCase() === name)?.value ?? "";
}

export function senderAddress(from: string) {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

export function isBounce(headers: Header[]) {
  const from = header(headers, "from");
  const contentType = header(headers, "content-type");
  if (BOUNCE_SENDER.test(senderAddress(from))) return true;
  if (BOUNCE_NAME.test(from.replace(/<[^>]*>/, ""))) return true;
  if (/multipart\/report/i.test(contentType) && /delivery-status/i.test(contentType)) return true;
  // A subject alone is not enough: a person can write "message not delivered?" in a real reply.
  return BOUNCE_SUBJECT.test(header(headers, "subject")) && /daemon|postmaster|delivery|no-?reply/i.test(from);
}

type PolledTouch = { sent_at: string };

/**
 * Which threads the reply check reads this run, at most `limit`. Threads sent in the last 48 hours come
 * first so a fresh bounce is caught within one run; the rest take turns in a rotation that starts at
 * `start`, so every older thread is still read now and then. No thread appears twice.
 */
export function prioritizeThreads<T extends PolledTouch>(touches: T[], start: number, now: number, limit = 300, recentMs = 48 * 3_600_000): T[] {
  const recent = touches.filter((touch) => now - Date.parse(touch.sent_at) <= recentMs);
  const older = touches.filter((touch) => !recent.includes(touch));
  const offset = older.length ? ((start % older.length) + older.length) % older.length : 0;
  return [...recent, ...older.slice(offset), ...older.slice(0, offset)].slice(0, limit);
}

type BouncedTouch = { card_id: string; person_id: string; gmail_thread_id: string };

/**
 * A delivery failure is not a reply: remember the address is bad (so no path emails it again), stop the
 * sequence, and leave the card's status alone. Safe to repeat for the same bounce. The bounced_at stamp
 * feeds the morning auto-send's bounce brake.
 */
export async function markTouchBounced(db: SupabaseClient, touch: BouncedTouch, now = new Date()) {
  await db.from("touches").update({ bounced_at: now.toISOString() }).eq("gmail_thread_id", touch.gmail_thread_id).is("bounced_at", null);
  const { data: person, error } = await db.from("people").select("id,full_name,email,email_status,email_source,email_check,account_id,accounts(domain)").eq("id", touch.person_id).single();
  if (error || !person) throw new Error("Could not load the bounced contact.");
  const account = person.accounts as unknown as { domain: string } | null;
  if (person.email_status !== "invalid") await markBounced(db, person as RecipientPerson, account ? { id: person.account_id as string, domain: account.domain } : null);
  const { data: cadence } = await db.from("cadences").select("id").eq("card_id", touch.card_id).maybeSingle();
  if (cadence) {
    await db.from("cadences").update({ status: "stopped", completed_at: now.toISOString() }).eq("id", cadence.id).in("status", ["active", "paused"]);
    await db.from("cadence_steps").update({ status: "skipped", error: "The email bounced; sequence stopped. Fix the address before writing again." }).eq("cadence_id", cadence.id).in("status", ["pending", "ready", "failed"]).is("sent_at", null);
  }
}
