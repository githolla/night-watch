import { loadAutoSendView, type AutoSendControl, type AutoSendSummary } from "./autosend-view.ts";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import { LIST_DRAFT_HASH } from "./draft-scope.ts";
import { allFocus } from "./focus-data.ts";
import { isLikelyPersonName } from "./pipeline.ts";
import { localParts } from "./local-time.ts";
import { industryOf, roleOf, sizeOf, tally } from "./send-plan.ts";
import { dailySeries, funnel, nextUp, type Funnel, type NextUpLead, type SeriesDay } from "./home-stats.ts";
import { loadSentTouches } from "./sent-view.ts";
import { refreshLegacyFollowup } from "./followups.ts";
import { pendingFollowups, type NextFollowup } from "./next-followups.ts";
import { loadReplies, type ReplyItem } from "./replies-view.ts";
import type { QueueItem } from "../components/FollowupQueue.tsx";
import { seatSummary } from "./draft-summary.ts";
import { shiftDate } from "./sent-stats.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const DAY_MS = 86_400_000;

/** A follow-up for the inline queue; who may send it is added on the page, from the viewer. */
export type HomeFollowup = Omit<QueueItem, "canAct" | "canSend">;
export type HomeBounce = { personId: string; cardId: string; name: string; company: string; email: string | null; bouncedAt: string };
export type HomeList = { date: string; companies: number; sectors: Array<{ label: string; count: number }>; confirmed: number };
export type HomeData = {
  first: string;
  /** Replies that still need a response, strongest first, with what they wrote and the Gmail thread. */
  replies: ReplyItem[];
  /** Follow-ups waiting on a person now. */
  followups: HomeFollowup[];
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
  const [profile, connection, replies, bounces, list, autoSend, sent, meetings, drafts, unsent, followups] = await Promise.all([
    db.from("sender_profiles").select("from_name").eq("owner", owner).maybeSingle().then((r) => r.data),
    db.from("gmail_connections").select("email").eq("owner", owner).maybeSingle().then((r) => r.data),
    // The same 21 days and "needs a response" rule as the Replies badge in the sidebar.
    loadReplies(owner, now, 21).then((r) => r.items.filter((item) => item.group === "needs")).catch(() => []),
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
    pendingFollowups(db, { owner, now: now.getTime() }).catch(() => new Map<string, NextFollowup[]>()),
  ]);

  const strong = (item: ReplyItem) => Number(["positive", "referral"].includes(item.classification));
  const waiting = [...replies].sort((a, b) => strong(b) - strong(a) || b.repliedAt.localeCompare(a.repliedAt));

  // Follow-ups that came due and could not go out by themselves, with the text refreshed as the Follow-ups page shows it.
  const dueFollowups: HomeFollowup[] = [...followups.values()].flat().filter((step) => step.needsYou).map((step) => ({
    stepId: step.stepId, step: step.step, scheduledAt: step.scheduledAt, channel: step.channel, subject: step.subject, auto: step.auto, needsYou: true,
    body: refreshLegacyFollowup(step.body, { firstName: step.person.split(/\s+/)[0] || "there", company: step.company || "your team", baseSubject: step.subject ?? "", step: step.step, channel: step.channel === "email" ? "email" : "linkedin_message" }),
    person: step.person || "Unknown contact", title: "", company: step.company, status: "ready", sentAt: null,
  })).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

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
    followups: dueFollowups,
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
