import { loadAutoSendView, type AutoSendControl, type AutoSendSummary } from "./autosend-view.ts";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { allFocus } from "./focus-data.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { localParts } from "./local-time.ts";
import { industryOf, roleOf, sizeOf, tally } from "./send-plan.ts";
import { dailySeries, funnel, nextUp, type Funnel, type NextUpLead, type SeriesDay } from "./home-stats.ts";
import { loadSentTouches } from "./sent-view.ts";
import { seatSummary } from "./draft-summary.ts";
import { shiftDate } from "./sent-stats.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;
const REAL_REPLY = ["positive", "referral", "neutral", "objection", "negative"];

export type HomeReply = { cardId: string; name: string; title: string; company: string; classification: string; repliedAt: string };
export type HomeBounce = { personId: string; cardId: string; name: string; company: string; email: string | null; bouncedAt: string };
export type HomeList = { date: string; companies: number; sectors: Array<{ label: string; count: number }>; confirmed: number };
export type HomeData = {
  first: string;
  replies: HomeReply[];
  autoSend: { plan: AutoSendSummary; control: AutoSendControl; unconfirmedQueued: number } | null;
  /** Every unsent draft for Next up: the auto-send queue in order, then the ones still waiting. */
  queue: NextUpLead[];
  bounces: HomeBounce[];
  list: HomeList | null;
  gmailConnected: boolean;
  /** Unsent list emails waiting in Drafts, the same count Drafts shows. */
  drafts: number;
  /** 90 days, one entry per day, for the chart's ranges. */
  series: SeriesDay[];
  funnel: Funnel | null;
};

/** Everything Home shows for one seat, from the same sources as the pages it links to. Each part fails on its own. */
export async function loadHome(owner: Owner, now: Date = new Date()): Promise<HomeData> {
  const db = admin();
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const [profile, connection, replies, bounces, list, autoSend, sent, meetings, drafts, unsent] = await Promise.all([
    db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle().then((r) => r.data),
    db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle().then((r) => r.data),
    db.from("touches").select("card_id,reply_at,reply_classification,cards(status,accounts(name)),people(full_name,title)")
      .eq("sent_by", owner).eq("channel", "email").not("reply_at", "is", null).in("reply_classification", REAL_REPLY).gte("reply_at", since(21))
      .order("reply_at", { ascending: false }).limit(100).then((r) => r.data ?? []),
    db.from("touches").select("card_id,person_id,bounced_at,cards(status,accounts(name)),people(full_name,email,email_status)")
      .eq("sent_by", owner).eq("channel", "email").not("bounced_at", "is", null).gte("bounced_at", since(30))
      .order("bounced_at", { ascending: false }).limit(100).then((r) => r.data ?? []),
    db.from("reachout_lists").select("list_date,rows").eq("owner", owner).eq("status", "ready").gte("list_date", since(4).slice(0, 10))
      .order("list_date", { ascending: false }).limit(1).maybeSingle().then((r) => r.data),
    loadAutoSendView(owner).catch(() => null),
    // 90 days for the chart; the week view is the last 14 of them, so this week shows against the week before.
    loadSentTouches(owner, 90, now).catch(() => null),
    db.from("cards").select("id", { count: "exact", head: true }).eq("assigned_to", owner).eq("status", "meeting").then((r) => r.count ?? 0),
    seatSummary(owner).then((summary) => summary.unsent).catch(() => 0),
    db.from("cards").select("id,person_id,email_subject,accounts(name,domain,vertical),people(full_name,title,email,email_status,email_check,do_not_contact),signals!inner(hash)")
      .eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(500).then((r) => r.data ?? []),
  ]);

  type ReplyRow = { card_id: string; reply_at: string; reply_classification: string; cards: { status: string; accounts: { name: string | null } | null } | null; people: { full_name: string | null; title: string | null } | null };
  const seenReply = new Set<string>();
  const waiting = (replies as unknown as ReplyRow[])
    // Still with her: not booked, archived or dismissed.
    .filter((row) => !["meeting", "archived", "dismissed"].includes(row.cards?.status ?? "") && !seenReply.has(row.card_id) && Boolean(seenReply.add(row.card_id)))
    .map((row) => ({ cardId: row.card_id, name: row.people?.full_name ?? "", title: row.people?.title ?? "", company: row.cards?.accounts?.name ?? "", classification: row.reply_classification, repliedAt: row.reply_at }))
    .sort((a, b) => Number(["positive", "referral"].includes(b.classification)) - Number(["positive", "referral"].includes(a.classification)) || b.repliedAt.localeCompare(a.repliedAt));

  type BounceRow = { card_id: string; person_id: string; bounced_at: string; cards: { status: string; accounts: { name: string | null } | null } | null; people: { full_name: string | null; email: string | null; email_status: string | null } | null };
  const seenBounce = new Set<string>();
  const toFix = (bounces as unknown as BounceRow[])
    // Still bounced: the address was not fixed yet (a fixed one reopens the card and clears "invalid").
    .filter((row) => row.cards?.status === "sent" && row.people?.email_status === "invalid" && !seenBounce.has(row.person_id) && Boolean(seenBounce.add(row.person_id)))
    .map((row) => ({ personId: row.person_id, cardId: row.card_id, name: row.people?.full_name ?? "", company: row.cards?.accounts?.name ?? "", email: row.people?.email ?? null, bouncedAt: row.bounced_at }));

  let latest: HomeList | null = null;
  const rows = ((list as { rows?: Array<{ domain: string; sector?: string; company?: string }> } | null)?.rows ?? []);
  if (list && rows.length) {
    const { data: people } = await db.from("cards").select("people(email,email_status,email_check),accounts!inner(domain)").eq("assigned_to", owner).in("accounts.domain", rows.map((row) => row.domain));
    const confirmed = new Set(((people ?? []) as unknown as Array<{ people: { email: string | null; email_status: string | null; email_check: unknown } | null; accounts: { domain: string } }>).filter((row) => row.people && bulkSendable(row.people)).map((row) => row.accounts.domain));
    latest = { date: (list as { list_date: string }).list_date, companies: rows.length, sectors: tally(rows.map((row) => industryOf(row.sector, row.company))), confirmed: confirmed.size };
  }

  type DraftRow = { id: string; person_id: string; email_subject: string | null; accounts: { name: string | null; domain: string | null; vertical: string | null } | null; people: { full_name: string; title: string | null; email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null };
  const focus = new Map(allFocus().map((row) => [row.domain.toLowerCase(), row]));
  const seenDraft = new Set<string>();
  // The same people Drafts counts: real names, not opted out, once each.
  const waitingDrafts: NextUpLead[] = (unsent as unknown as DraftRow[])
    .filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seenDraft.has(row.person_id) && Boolean(seenDraft.add(row.person_id)))
    .map((row) => {
      const person = row.people!;
      const listRow = row.accounts?.domain ? focus.get(row.accounts.domain.toLowerCase()) : undefined;
      const confirmed = bulkSendable(person) && sendableAddress(person);
      return {
        id: row.id, name: person.full_name, title: person.title ?? "", company: row.accounts?.name ?? row.accounts?.domain ?? "", subject: row.email_subject ?? "",
        industry: industryOf(listRow?.sector ?? row.accounts?.vertical, row.accounts?.name), role: roleOf(person.title), size: sizeOf(listRow?.revenue), confirmed,
        group: "waiting" as const, position: 0, time: null,
        reason: !sendableAddress(person) ? "No email address yet" : confirmed ? "Not in a window yet" : "Address not confirmed",
      };
    });
  const queued: NextUpLead[] = (autoSend?.emails ?? []).map(({ id, name, title, company, subject, industry, role, size, confirmed, group, position, time, reason }) => ({ id, name, title, company, subject, industry, role, size, confirmed, group, position, time, reason }));

  const since90 = sent ? shiftDate(sent.today, -89) : "";

  return {
    first: ((profile?.from_name as string | undefined) ?? "").trim().split(/\s+/)[0] || (owner === "josh" ? "Josh" : "Suuchi"),
    replies: waiting,
    autoSend: autoSend ? { plan: autoSend.plan, control: autoSend.control, unconfirmedQueued: autoSend.emails.filter((email) => (email.group === "going" || email.group === "later") && !email.confirmed).length } : null,
    queue: nextUp(waitingDrafts, queued),
    bounces: toFix,
    list: latest,
    gmailConnected: Boolean((connection?.email as string | undefined)?.trim()),
    drafts,
    series: sent ? dailySeries(sent.touches, 90, sent.today, sent.dayOf) : [],
    funnel: sent ? funnel(sent.touches, since90, sent.dayOf, meetings) : null,
  };
}

/** "Good morning" in the send time zone. */
export function greeting(now: Date = new Date()) {
  const hour = localParts(now).hour;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
