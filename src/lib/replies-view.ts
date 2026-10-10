import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;
const REAL_REPLY = ["positive", "referral", "neutral", "objection", "negative"];

export type ReplyItem = {
  cardId: string; name: string; title: string; company: string;
  classification: string; repliedAt: string; snippet: string | null;
  /** Opens the thread in the seat's Gmail. */
  gmailUrl: string | null;
  group: "needs" | "booked" | "closed";
};

/** What to do next, by how the reply reads. */
export const NEXT_STEP: Record<string, string> = {
  positive: "Reply within a day and offer two times to talk.",
  referral: "Write to the person they named, and say who pointed you to them.",
  neutral: "Answer their question, then ask for 15 minutes.",
  objection: "Acknowledge it, share one relevant example, and leave the door open.",
  negative: "Nothing to do. They will not be emailed again.",
};

/** One seat's replies, newest first: each card once, with what they wrote when it was kept. */
export async function loadReplies(owner: Owner, now: Date = new Date(), days = 60): Promise<{ items: ReplyItem[]; gmail: string | null }> {
  const db = admin();
  const since = new Date(now.getTime() - days * DAY_MS).toISOString();
  const [{ data: touches }, { data: events }, { data: connection }] = await Promise.all([
    db.from("touches").select("card_id,reply_at,reply_classification,gmail_thread_id,cards(status,accounts(name)),people(full_name,title)")
      .eq("sent_by", owner).eq("channel", "email").not("reply_at", "is", null).in("reply_classification", REAL_REPLY).gte("reply_at", since)
      .order("reply_at", { ascending: false }).limit(300),
    db.from("message_experiments").select("card_id,context,created_at").eq("owner", owner).eq("goal", "Inbound reply processing").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
    db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle(),
  ]);
  const snippets = new Map<string, string>();
  for (const event of (events ?? []) as Array<{ card_id: string; context: string | null }>) {
    if (snippets.has(event.card_id)) continue;
    try { const state = JSON.parse(event.context ?? "{}") as { snippet?: string }; if (state.snippet) snippets.set(event.card_id, state.snippet); } catch { /* an older record without one */ }
  }
  const gmail = (connection?.email as string | undefined)?.trim() || null;
  type Row = { card_id: string; reply_at: string; reply_classification: string; gmail_thread_id: string | null; cards: { status: string; accounts: { name: string | null } | null } | null; people: { full_name: string | null; title: string | null } | null };
  const seen = new Set<string>();
  const items = ((touches ?? []) as unknown as Row[]).filter((row) => !seen.has(row.card_id) && Boolean(seen.add(row.card_id))).map((row): ReplyItem => {
    const status = row.cards?.status ?? "";
    const group: ReplyItem["group"] = ["meeting", "qualified", "opportunity"].includes(status) ? "booked" : ["archived", "dismissed"].includes(status) || row.reply_classification === "negative" ? "closed" : "needs";
    return {
      cardId: row.card_id, name: row.people?.full_name ?? "", title: row.people?.title ?? "", company: row.cards?.accounts?.name ?? "",
      classification: row.reply_classification, repliedAt: row.reply_at, snippet: snippets.get(row.card_id) ?? null,
      gmailUrl: row.gmail_thread_id ? `https://mail.google.com/mail/${gmail ? `?authuser=${encodeURIComponent(gmail)}` : ""}#all/${row.gmail_thread_id}` : null,
      group,
    };
  });
  return { items, gmail };
}

/** How many replies still wait on this seat: the number on the Replies tab. */
export async function waitingReplyCount(owner: Owner, now: Date = new Date()) {
  const { items } = await loadReplies(owner, now, 21);
  return items.filter((item) => item.group === "needs").length;
}
