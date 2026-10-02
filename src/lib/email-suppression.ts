import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Opt-outs belong to the address, not to one person row: the same buyer can sit on several cards and
 * several people rows, so "no" on one must stop all of them.
 */

/** Escape % _ and \ so an address is matched literally by ilike (case-insensitive, no wildcards). */
export function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** True when any people row with this address (any case) is marked do-not-contact. Fails closed. */
export async function emailSuppressed(db: SupabaseClient, email: string | null | undefined): Promise<boolean> {
  const address = (email ?? "").trim();
  if (!address) return false;
  const { data, error } = await db.from("people").select("id").ilike("email", likeLiteral(address)).eq("do_not_contact", true).limit(1);
  if (error || !Array.isArray(data)) throw new Error("Could not check the opt-out list. Nothing was sent.");
  return data.length > 0;
}

const OPT_OUT_PHRASES = new Set(["no", "no thanks", "no thank you", "unsubscribe", "remove me", "please remove me", "stop", "not interested"]);

/** The first line the person wrote, without quoted history. */
function firstOwnLine(body: string) {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^on .+wrote:?$/i.test(line) || /^-+\s*original message/i.test(line) || /^from:\s/i.test(line)) return "";
    if (!line || line.startsWith(">")) continue;
    return line;
  }
  return "";
}

/**
 * A reply that asks to stop: a 'negative' classification, or a first line that is exactly a short opt-out
 * phrase. Never for a positive or referral reply, so "No problem, Tuesday works" is not an opt-out.
 */
export function isOptOutReply(body: string, classification: string | null | undefined) {
  if (classification === "negative") return true;
  if (classification === "positive" || classification === "referral") return false;
  const line = firstOwnLine(body).toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  return OPT_OUT_PHRASES.has(line);
}

/**
 * Mark the person do-not-contact on every row that shares their address, then stop every active or paused
 * sequence for those people and skip the steps not yet sent. Safe to repeat. Throws when a write fails.
 */
export async function optOutPerson(db: SupabaseClient, personId: string) {
  const { data: person, error } = await db.from("people").select("id,email").eq("id", personId).maybeSingle();
  if (error) throw new Error("Could not load the person to opt out.");
  const email = ((person?.email as string | null | undefined) ?? "").trim();
  const ids = new Set<string>([personId]);
  if (email) {
    const { data: rows, error: flagError } = await db.from("people").update({ do_not_contact: true }).ilike("email", likeLiteral(email)).select("id");
    if (flagError) throw new Error("Could not save the opt-out.");
    for (const row of (rows ?? []) as Array<{ id: string }>) ids.add(row.id);
  }
  const { error: idError } = await db.from("people").update({ do_not_contact: true }).eq("id", personId);
  if (idError) throw new Error("Could not save the opt-out.");
  const { data: cadences, error: cadenceError } = await db.from("cadences").select("id").in("person_id", [...ids]).in("status", ["active", "paused"]);
  if (cadenceError) throw new Error("Could not load the sequences to stop.");
  const cadenceIds = ((cadences ?? []) as Array<{ id: string }>).map((cadence) => cadence.id);
  if (cadenceIds.length) {
    const stopped = await db.from("cadences").update({ status: "stopped", completed_at: new Date().toISOString() }).in("id", cadenceIds).in("status", ["active", "paused"]);
    if (stopped.error) throw new Error("Could not stop the sequences.");
    const skipped = await db.from("cadence_steps").update({ status: "skipped", error: "The contact opted out; sequence stopped." }).in("cadence_id", cadenceIds).in("status", ["pending", "ready", "failed"]).is("sent_at", null);
    if (skipped.error) throw new Error("Could not close the unsent steps.");
  }
  return { people: ids.size, cadences: cadenceIds.length };
}
