import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPerson } from "./apollo.ts";
import { bulkSendable } from "./bulk-sendable.ts";
import { addressCheck, replacementCheck } from "./address-history.ts";
import { addressRejected } from "./address-history.ts";
import { addressIdentityProblem } from "./address-identity.ts";

type Match = Awaited<ReturnType<typeof matchPerson>>;
export function matchingVerifiedBuyer(name: string, domain: string, match: Match) {
  if (!match?.email || match.email_status !== "verified" || match.stillHere === false || match.currentDomain !== domain.replace(/^www\./, "").toLowerCase()) return false;
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
  const parts = name.trim().split(/\s+/).filter(part => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(part));
  return normalize(parts[0] || "") === normalize(match.first_name || "") && normalize(parts.at(-1) || "") === normalize(match.last_name || "") && !addressIdentityProblem(match.email, name);
}
type Person = { id: string; full_name: string; email: string | null; email_status: string; email_source: string | null; email_check: unknown; do_not_contact: boolean };
type Card = { id: string; assigned_to: string; auto_send_hold: boolean | null; auto_send_hold_reason: string | null; accounts: { id: string; name: string; domain: string; status: string }; people: Person };
export async function recoverSendQueue(db: SupabaseClient, options: { limit?: number; budgetMs?: number } = {}) {
  if (!process.env.APOLLO_API_KEY || process.env.APOLLO_API_KEY === "[SENSITIVE]") throw new Error("Apollo is not configured.");
  const { data, error } = await db.from("cards").select("id,assigned_to,auto_send_hold,auto_send_hold_reason,accounts!inner(id,name,domain,status),people!inner(id,full_name,email,email_status,email_source,email_check,do_not_contact),signals!inner(hash)").in("status", ["new", "edited", "approved"]).like("signals.hash", "operator-shortlist-20260923:%").limit(500);
  if (error) throw new Error(error.message);
  const seen = new Set<string>(), now = Date.now();
  const cards = (data as unknown as Card[]).filter(card => {
    if (seen.has(card.people.id) || card.accounts.status !== "active" || card.people.do_not_contact || card.auto_send_hold || bulkSendable(card.people)) return false;
    if (card.auto_send_hold_reason && !card.auto_send_hold_reason.startsWith("Automatic sends need a verified personal mailbox")) return false;
    if (now - Date.parse(String(addressCheck(card.people.email_check).apolloAttemptAt || "")) < 24 * 3600000) return false;
    seen.add(card.people.id); return true;
  }).sort((a, b) => Number(b.assigned_to === "suuchi") - Number(a.assigned_to === "suuchi")).slice(0, options.limit ?? 40);
  const results: Array<{ owner: string; name: string; company: string; result: string }> = [];
  for (let offset = 0; offset < cards.length; offset += 3) {
    if (Date.now() - now > (options.budgetMs ?? 200000)) break;
    await Promise.all(cards.slice(offset, offset + 3).map(async card => {
      let outcome = "no verified match";
      try {
        const match = await matchPerson(card.people.full_name, card.accounts.domain);
        if (matchingVerifiedBuyer(card.people.full_name, card.accounts.domain, match) && match?.email) {
          if (await addressRejected(db, match.email)) outcome = "previously rejected address remains blocked";
          else {
            const { data: current, error: readError } = await db.from("people").select("email_check,do_not_contact").eq("id", card.people.id).single();
            if (readError) throw new Error(readError.message);
            if (current.do_not_contact) return;
            const check = replacementCheck({ ...card.people, email_check: current.email_check }, { email: match.email, level: "deliverable", source: "apollo", status: "verified", reason: "Apollo verified this address and matched the current employer.", checkedAt: new Date().toISOString(), apolloAttemptAt: new Date().toISOString() });
            const saved = await db.from("people").update({ email: match.email, email_status: "verified", email_source: "apollo", email_verified_at: new Date().toISOString(), email_check: check, ...(match.linkedin_url ? { linkedin_url: match.linkedin_url } : {}) }).eq("id", card.people.id).eq("do_not_contact", false);
            if (saved.error) throw new Error(saved.error.message);
            const holds = await db.from("cards").update({ auto_send_hold_reason: null }).eq("person_id", card.people.id).in("status", ["new", "edited", "approved"]).like("auto_send_hold_reason", "Automatic sends need a verified personal mailbox%");
            if (holds.error) throw new Error(holds.error.message);
            outcome = "verified";
          }
        } else if (match?.stillHere === false) outcome = "current employer differs; not queued";
      } catch (cause: unknown) { outcome = cause instanceof Error ? cause.message : "enrichment failed"; }
      if (outcome !== "verified") {
        const { data: current } = await db.from("people").select("email_check").eq("id", card.people.id).maybeSingle();
        await db.from("people").update({ email_check: { ...addressCheck(current?.email_check), apolloAttemptAt: new Date().toISOString(), apolloAttemptResult: outcome } }).eq("id", card.people.id);
      }
      results.push({ owner: card.assigned_to, name: card.people.full_name, company: card.accounts.name, result: outcome });
    }));
  }
  return { attempted: results.length, verified: results.filter(result => result.result === "verified").length, results };
}
