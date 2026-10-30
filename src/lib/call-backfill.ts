import type { SupabaseClient } from "@supabase/supabase-js";
import { newCallPlan } from "./call-plan.ts";
import type { Owner } from "./types.ts";

/** A missing email sequence gets only a call plan, never retroactive automatic email steps. */
export async function backfillCallPlans(db: SupabaseClient) {
  type Row = { card_id: string; person_id: string; sent_by: Owner; sent_at: string; bounced_at: string | null; people: { do_not_contact: boolean } | null; cards: { status: string; assigned_to: Owner; accounts: { status: string } | null } | null };
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 500) {
    const read = await db.from("touches").select("card_id,person_id,sent_by,sent_at,bounced_at,people(do_not_contact),cards(status,assigned_to,accounts(status))").eq("channel", "email").in("sent_by", ["josh", "suuchi"]).not("sent_at", "is", null).order("sent_at", { ascending: true }).range(offset, offset + 499);
    if (read.error) throw new Error("Could not load sent emails for call planning.");
    rows.push(...((read.data ?? []) as unknown as Row[]));
    if ((read.data?.length ?? 0) < 500) break;
  }
  const existingCards = new Set<string>();
  for (let offset = 0; ; offset += 500) {
    const existing = await db.from("cadences").select("card_id").range(offset, offset + 499);
    if (existing.error) throw new Error("Could not preserve existing outreach sequences.");
    for (const cadence of existing.data ?? []) existingCards.add(cadence.card_id as string);
    if ((existing.data?.length ?? 0) < 500) break;
  }
  const seen = new Set<string>();
  let created = 0;
  for (const row of rows) {
    if (existingCards.has(row.card_id)) continue;
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
