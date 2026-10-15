import type { SupabaseClient } from "@supabase/supabase-js";
import { newCallPlan } from "./call-plan.ts";
import type { Owner } from "./types.ts";

/** A missing email sequence gets only a call plan, never retroactive automatic email steps. */
export async function backfillCallPlans(db: SupabaseClient) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const read = await db.from("touches").select("card_id,person_id,sent_by,sent_at,bounced_at,people(do_not_contact),cards(status,assigned_to,accounts(status))").eq("channel", "email").not("sent_at", "is", null).gte("sent_at", since).order("sent_at", { ascending: true }).limit(3000);
  if (read.error) throw new Error("Could not load recent emails for call planning.");
  type Row = { card_id: string; person_id: string; sent_by: Owner; sent_at: string; bounced_at: string | null; people: { do_not_contact: boolean } | null; cards: { status: string; assigned_to: Owner; accounts: { status: string } | null } | null };
  const rows = (read.data ?? []) as unknown as Row[];
  const seen = new Set<string>();
  let created = 0;
  for (const row of rows) {
    if (!row.cards || !row.people || row.bounced_at || row.people.do_not_contact || row.cards.assigned_to !== row.sent_by || ["dismissed", "archived", "replied", "positive", "meeting"].includes(row.cards.status) || ["client", "do_not_contact", "paused"].includes(row.cards.accounts?.status ?? "")) continue;
    const key = `${row.sent_by}:${row.person_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const saved = await db.from("cadences").upsert({ card_id: row.card_id, person_id: row.person_id, owner: row.sent_by, mode: "manual", status: "completed", rules: { origin: "call_backfill", call: newCallPlan(row.sent_at) } }, { onConflict: "card_id", ignoreDuplicates: true }).select("id");
    if (saved.error) throw new Error("Could not backfill a call plan.");
    created += saved.data?.length ?? 0;
  }
  return created;
}
