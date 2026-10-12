import { loadAutoSendView, type AutoSendControl, type AutoSendSummary } from "./autosend-view.ts";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { summarizeList, type ListCard, type ListSummary } from "./company-lists.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { draftTemplates } from "./draft-summary.ts";
import type { CurrentTemplates } from "./draft-templates.ts";
import { dailySeries, type SeriesDay } from "./home-stats.ts";
import { linkedinTaskCount, loadLinkedInDone } from "./linkedin-tasks.ts";
import { todayRows, type BounceRow, type HomeTodayRows } from "./home-today.ts";
import { localParts } from "./local-time.ts";
import { pendingFollowups } from "./next-followups.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { loadReplies, type ReplyItem } from "./replies-view.ts";
import { industryOf } from "./send-plan.ts";
import { loadSentTouches } from "./sent-view.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;
const POSITIVE = ["positive", "referral"];

export type HomeBounce = { personId: string; cardId: string; name: string; company: string; email: string | null; bouncedAt: string };
/** The seat's unsent list emails by what each needs, and how the next send window stands. */
export type HomeDrafts = { total: number; ready: number; review: number; held: number; missing: number; checking: number; next: number; nextUnapproved: number;
  /** Unsent drafts that also have a LinkedIn message written, for sending by hand. */
  linkedinWritten: number };
/** What happened today so far, in the send time zone. Emails come from the 90-day series. */
export type HomeToday = { replies: number; interested: number; bounced: number; linkedin: number; rows: HomeTodayRows };
export type { HomeTodayRow, HomeTodayRows } from "./home-today.ts";
export type HomeData = {
  first: string;
  /** Replies that still need a response, strongest first. */
  replies: ReplyItem[];
  /** Replies that came in over the last day, for the morning briefing. */
  newReplies: number;
  followupsDue: number;
  /** LinkedIn messages ready to send by hand now, and how many went out in the last 7 days. */
  linkedin: number;
  linkedinSent: number;
  autoSend: { plan: AutoSendSummary; control: AutoSendControl } | null;
  bounces: HomeBounce[];
  drafts: HomeDrafts;
  /** The opening and subject most unsent drafts share, for the first to-do step. */
  templates: CurrentTemplates | null;
  /** Recent nightly lists, newest first, each summed into progress and results. */
  lists: ListSummary[];
  /** Domains on the list the editor opens on, so links know whether a person's draft is there. */
  listed: string[];
  /** When the newest list finished, and whether tonight's is being built now. */
  lastListAt: string | null;
  building: boolean;
  gmailConnected: boolean;
  /** 90 days, one entry per day, for the results ranges. */
  series: SeriesDay[];
  meetings: number;
  today: HomeToday;
};

type Person = { email: string | null; email_status: string | null; email_check: unknown; do_not_contact?: boolean | null };

type ListRecord = { list_date: string; status: string; updated_at: string; rows: Array<{ domain: string; sector?: string; company?: string }> | null };

/** Each recent list summed into progress and results, from its companies' cards and positive replies. */
async function summarizeLists(owner: Owner, records: ListRecord[]): Promise<{ records: ListRecord[]; summaries: ListSummary[] }> {
  const domains = [...new Set(records.flatMap((list) => (list.rows ?? []).map((row) => row.domain)))];
  if (!domains.length) return { records, summaries: [] };
  const db = admin();
  const [{ data: cards }, { data: replied }] = await Promise.all([
    db.from("cards").select("id,status,auto_send_hold,accounts!inner(domain),people(email,email_status,email_check,do_not_contact)").eq("assigned_to", owner).in("accounts.domain", domains).limit(3000),
    db.from("touches").select("card_id").eq("sent_by", owner).in("reply_classification", POSITIVE).limit(2000),
  ]);
  const positive = new Set(((replied ?? []) as Array<{ card_id: string }>).map((row) => row.card_id));
  type CardRow = { id: string; status: string; auto_send_hold: boolean | null; accounts: { domain: string }; people: Person | null };
  const listCards: ListCard[] = ((cards ?? []) as unknown as CardRow[]).map((card) => ({
    domain: card.accounts.domain, status: card.status, held: Boolean(card.auto_send_hold),
    sendable: Boolean(card.people && !card.people.do_not_contact && sendableAddress(card.people)), positiveReply: positive.has(card.id),
  }));
  return { records, summaries: records.map((list) => summarizeList({ date: list.list_date, building: list.status === "building", rows: (list.rows ?? []).map((row) => ({ domain: row.domain, sector: industryOf(row.sector, row.company) })) }, listCards)) };
}

/** Everything Overview shows for one seat, from the same sources as the pages it links to. Each part fails on its own. */
export async function loadHome(owner: Owner, now: Date = new Date()): Promise<HomeData> {
  const db = admin();
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS).toISOString();
  const local = localParts(now);
  const dayStart = new Date(now.getTime() - local.minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds()).toISOString();
  const [profile, connection, allReplies, bounces, lists, autoSend, sent, meetings, unsent, followups, linkedin, linkedinDone, templates] = await Promise.all([
    db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle().then((r) => r.data),
    db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle().then((r) => r.data),
    // The same 21 days and "needs a response" rule as the Replies badge in the sidebar.
    loadReplies(owner, now, 21).then((r) => r.items).catch(() => []),
    db.from("touches").select("id,card_id,person_id,sent_at,bounced_at,cards(status,accounts(name,domain)),people(full_name,email,email_status)")
      .eq("sent_by", owner).eq("channel", "email").not("bounced_at", "is", null).gte("bounced_at", since(30))
      .order("bounced_at", { ascending: false }).limit(100).then((r) => r.data ?? []),
    // The lists and their companies chain together, so they run alongside everything else instead of after it.
    db.from("reachout_lists").select("list_date,status,rows,updated_at").eq("owner", owner).in("status", ["ready", "building"]).gte("list_date", since(30).slice(0, 10))
      .order("list_date", { ascending: false }).limit(8).then((r) => summarizeLists(owner, (r.data ?? []) as unknown as ListRecord[])),
    loadAutoSendView(owner).catch(() => null),
    loadSentTouches(owner, 90, now).catch(() => null),
    db.from("cards").select("id", { count: "exact", head: true }).eq("assigned_to", owner).eq("status", "meeting").then((r) => r.count ?? 0),
    db.from("cards").select("id,person_id,status,auto_send_hold,linkedin_message,people(full_name,email,email_status,email_check,do_not_contact),signals!inner(hash)")
      .eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(500).then((r) => r.data ?? []),
    pendingFollowups(db, { owner, now: now.getTime() }).catch(() => null),
    linkedinTaskCount(owner, now).catch(() => 0),
    loadLinkedInDone(owner, now, 7).catch(() => []),
    draftTemplates(owner).catch(() => null),
  ]);
  const replies = allReplies.filter((item) => item.group === "needs");

  const strong = (item: ReplyItem) => Number(POSITIVE.includes(item.classification));
  const waiting = [...replies].sort((a, b) => strong(b) - strong(a) || b.repliedAt.localeCompare(a.repliedAt));

  const seenBounce = new Set<string>();
  const toFix = (bounces as unknown as BounceRow[])
    // Still bounced: the address was not fixed yet (a fixed one reopens the card and clears "invalid").
    .filter((row) => row.cards?.status === "sent" && row.people?.email_status === "invalid" && !seenBounce.has(row.person_id) && Boolean(seenBounce.add(row.person_id)))
    .map((row) => ({ personId: row.person_id, cardId: row.card_id, name: row.people?.full_name ?? "", company: row.cards?.accounts?.name ?? "", email: row.people?.email ?? null, bouncedAt: row.bounced_at }));

  // The same people Drafts counts: real names, not opted out, once each.
  type DraftRow = { id: string; person_id: string; status: string; auto_send_hold: boolean | null; linkedin_message: string | null; people: (Person & { full_name: string }) | null };
  const seenDraft = new Set<string>();
  const people = (unsent as unknown as DraftRow[]).filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seenDraft.has(row.person_id) && Boolean(seenDraft.add(row.person_id)));
  const going = (autoSend?.emails ?? []).filter((email) => email.group === "going");
  const drafts: HomeDrafts = { total: people.length, ready: 0, review: 0, held: 0, missing: 0, checking: 0, next: going.length, nextUnapproved: going.filter((email) => email.status !== "approved").length, linkedinWritten: people.filter((row) => Boolean(row.linkedin_message?.trim())).length };
  for (const row of people) {
    const person = row.people!;
    if (!sendableAddress(person)) { drafts.missing++; continue; }
    if (!bulkSendable(person)) drafts.checking++;
    if (row.auto_send_hold) drafts.held++;
    else if (row.status === "approved") drafts.ready++;
    else drafts.review++;
  }

  // The list the editor opens on: the newest ready list with companies, as loadNightlyLists picks it.
  const listed = new Set((lists.records.find((list) => list.status === "ready" && list.rows?.length)?.rows ?? []).map((row) => row.domain.toLowerCase()));
  const rows = todayRows({ owner, dayStart, listed, bounces: bounces as unknown as BounceRow[], replies: allReplies, sent: sent?.touches ?? [], queue: going, linkedin: linkedinDone });

  return {
    first: ((profile?.from_name as string | undefined) ?? "").trim().split(/\s+/)[0] || (owner === "josh" ? "Josh" : "Suuchi"),
    replies: waiting,
    newReplies: waiting.filter((item) => Date.parse(item.repliedAt) >= now.getTime() - DAY_MS).length,
    followupsDue: followups ? [...followups.values()].flat().filter((step) => step.needsYou).length : 0,
    linkedin,
    linkedinSent: linkedinDone.length,
    autoSend: autoSend ? { plan: autoSend.plan, control: autoSend.control } : null,
    bounces: toFix,
    drafts,
    templates,
    lists: lists.summaries,
    listed: [...listed],
    lastListAt: lists.records.find((list) => list.status === "ready")?.updated_at ?? null,
    building: lists.records.some((list) => list.status === "building"),
    gmailConnected: Boolean((connection?.email as string | undefined)?.trim()),
    series: sent ? dailySeries(sent.touches, 90, sent.today, sent.dayOf) : [],
    meetings,
    today: {
      replies: rows.replies.length,
      interested: rows.replies.filter((row) => row.tone === "good").length,
      bounced: rows.bounces.length,
      linkedin: rows.linkedin.length,
      rows,
    },
  };
}

/** "Good morning" in the send time zone. */
export function greeting(now: Date = new Date()) {
  const hour = localParts(now).hour;
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}
