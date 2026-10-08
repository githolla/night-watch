import type { SupabaseClient } from "@supabase/supabase-js";
import { bulkSendable } from "./bulk-sendable.ts";

/** The next follow-up waiting for one sent email, in plain terms for the person who sent it. */
export type NextFollowup = {
  stepId: string; cardId: string; owner: string; step: number; scheduledAt: string; channel: string;
  subject: string | null; body: string;
  /** Goes out by itself: an automatic email step to a confirmed address. */
  auto: boolean;
  /** Waiting on a person now: it came due and could not go out by itself, or it failed. */
  needsYou: boolean;
  person: string; company: string;
};

type Row = {
  id: string; step_number: number; channel: string; kind: string; subject: string | null; body: string | null; status: string; scheduled_at: string; error: string | null; sent_at: string | null;
  cadences: { card_id: string; owner: string; status: string; people: { full_name: string; email: string | null; email_status: string | null; email_check: unknown } | null; cards: { accounts: { name: string | null } | null } | null } | null;
};

// The cadence cron runs every fifteen minutes; an automatic step still waiting well after that needs a look.
const GRACE_MS = 45 * 60_000;

/** Pure: whether a step goes out by itself, and whether it needs a person now. */
export function followupState(row: Pick<Row, "channel" | "kind" | "status" | "scheduled_at" | "error" | "sent_at">, confirmed: boolean, now: number) {
  const auto = row.channel === "email" && row.kind === "automatic" && confirmed;
  const due = Date.parse(row.scheduled_at) <= now;
  const needsYou = !row.sent_at && (row.status === "ready" || row.status === "failed" || (due && (!auto || Date.parse(row.scheduled_at) <= now - GRACE_MS)));
  return { auto, needsYou };
}

/**
 * The earliest follow-up still waiting on each active sequence, keyed by card. With `owner`, only that seat's.
 * Steps already being delivered (sent_at set) are left out: they are no longer something to edit or skip.
 */
export async function nextFollowups(db: SupabaseClient, options: { owner?: string; now?: number } = {}): Promise<Map<string, NextFollowup>> {
  const now = options.now ?? Date.now();
  let query = db.from("cadence_steps")
    .select("id,step_number,channel,kind,subject,body,status,scheduled_at,error,sent_at,cadences!inner(card_id,owner,status,people(full_name,email,email_status,email_check),cards(accounts(name)))")
    .in("status", ["pending", "ready", "failed"]).is("sent_at", null).eq("cadences.status", "active")
    .order("scheduled_at", { ascending: true }).limit(3000);
  if (options.owner) query = query.eq("cadences.owner", options.owner);
  const { data, error } = await query;
  if (error) throw new Error(`Could not read follow-ups: ${error.message}`);
  const next = new Map<string, NextFollowup>();
  for (const row of (data ?? []) as unknown as Row[]) {
    const cadence = row.cadences;
    if (!cadence || next.has(cadence.card_id)) continue;
    const person = cadence.people;
    const { auto, needsYou } = followupState(row, Boolean(person && bulkSendable(person)), now);
    next.set(cadence.card_id, {
      stepId: row.id, cardId: cadence.card_id, owner: cadence.owner, step: row.step_number, scheduledAt: row.scheduled_at, channel: row.channel,
      subject: row.subject, body: row.body ?? "", auto, needsYou,
      person: person?.full_name ?? "", company: cadence.cards?.accounts?.name ?? "",
    });
  }
  return next;
}
