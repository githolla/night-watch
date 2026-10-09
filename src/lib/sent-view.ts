import { allFocus } from "./focus-data.ts";
import { localParts } from "./local-time.ts";
import { sentStats, type SentStats, type SentTouch } from "./sent-stats.ts";
import { industryOf, roleOf, sizeOf } from "./send-plan.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;

/** One seat's sent emails for the period, read from the touches every send records. */
export async function loadSentView(owner: Owner, days: number, now: Date = new Date()): Promise<SentStats> {
  // Reach back past the period so a card's earlier email marks a later one as a follow-up.
  const since = new Date(now.getTime() - (days + 60) * DAY_MS).toISOString();
  const { data, error } = await admin().from("touches")
    .select("id,card_id,sent_at,reply_at,reply_classification,bounced_at,people(full_name,title),cards(email_subject,accounts(name,domain,vertical))")
    .eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", since)
    .order("sent_at", { ascending: false }).limit(2000);
  if (error) throw new Error(error.message);
  type Row = { id: string; card_id: string; sent_at: string; reply_at: string | null; reply_classification: string | null; bounced_at: string | null; people: { full_name: string | null; title: string | null } | null; cards: { email_subject: string | null; accounts: { name: string | null; domain: string | null; vertical: string | null } | null } | null };
  const listRows = new Map(allFocus().map((row) => [row.domain.toLowerCase(), row]));
  const touches: SentTouch[] = ((data ?? []) as unknown as Row[]).map((row) => {
    const account = row.cards?.accounts;
    const listRow = account?.domain ? listRows.get(account.domain.toLowerCase()) : undefined;
    return {
      id: row.id, cardId: row.card_id, sentAt: row.sent_at, replyAt: row.reply_at, replyClass: row.reply_classification, bouncedAt: row.bounced_at,
      name: row.people?.full_name ?? "", title: row.people?.title ?? "", company: account?.name ?? account?.domain ?? "", subject: row.cards?.email_subject ?? "",
      industry: industryOf(listRow?.sector ?? account?.vertical, account?.name), role: roleOf(row.people?.title), size: sizeOf(listRow?.revenue),
    };
  });
  return sentStats(touches, days, localParts(now).date, (iso) => localParts(new Date(iso)).date);
}
