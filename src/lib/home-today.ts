import type { AutoSendEmail } from "./autosend-view.ts";
import type { LinkedInDone } from "./linkedin-task-list.ts";
import type { ReplyItem } from "./replies-view.ts";
import { outcomeOf, type SentTouch } from "./sent-stats.ts";
import type { Owner } from "./types.ts";

const POSITIVE = ["positive", "referral"];

/** One thing that happened today (or is still to go out), as a row under the Today numbers. */
export type HomeTodayRow = {
  id: string; name: string; company: string; domain: string;
  /** When it happened, or the planned send time for the queue. */
  at: string | null; time: string | null;
  note: string; tone: "good" | "warn" | "plain";
  followup?: boolean;
  /** The company on the list, or the thread in Gmail. */
  href: string | null; gmailUrl?: string | null;
  /** A bounce that still needs a new address. */
  fix?: { personId: string; email: string | null };
};
export type HomeTodayRows = { sent: HomeTodayRow[]; queue: HomeTodayRow[]; replies: HomeTodayRow[]; linkedin: HomeTodayRow[]; bounces: HomeTodayRow[] };

/** A bounced email touch, with whether its address was fixed since. */
export type BounceRow = { id: string; card_id: string; person_id: string; sent_at: string; bounced_at: string; cards: { status: string; accounts: { name: string | null; domain: string | null } | null } | null; people: { full_name: string | null; email: string | null; email_status: string | null } | null };

const OUTCOME_NOTE: Record<ReturnType<typeof outcomeOf>, string> = { interested: "Replied, interested", replied: "Replied", bounced: "Bounced", "out of office": "Out of office", sent: "Delivered" };
const LINKEDIN_NOTE: Record<string, string> = { linkedin_request: "Connection request", linkedin_message: "Message", linkedin_comment: "Comment on a post" };
const REPLY_NOTE: Record<string, string> = { positive: "Interested", referral: "Pointed you to someone", neutral: "Asked a question", objection: "Pushed back", negative: "Not interested" };

/** Where a person's row opens: their draft when the company is on today's list (the list editor shows only that
 *  list), otherwise the company's page, which has everyone there, every email and every reply. */
export function personHref(owner: Owner, listed: ReadonlySet<string>, cardId: string, domain: string | null | undefined): string {
  if (domain && !listed.has(domain.toLowerCase())) return `/accounts/${encodeURIComponent(domain)}`;
  return `/outreach?list=${owner}&batch=today&card=${cardId}`;
}

/** Today's sends, queue, replies, LinkedIn and bounces as rows, newest first, each linking to its company or thread. */
export function todayRows(input: { owner: Owner; dayStart: string; listed?: ReadonlySet<string>; bounces: BounceRow[]; replies: ReplyItem[]; sent: SentTouch[]; queue: AutoSendEmail[]; linkedin: LinkedInDone[] }): HomeTodayRows {
  const listed = input.listed ?? new Set<string>();
  const card = (cardId: string, domain: string | null | undefined) => personHref(input.owner, listed, cardId, domain);
  const start = Date.parse(input.dayStart);
  const isToday = (iso: string) => Date.parse(iso) >= start;
  const sentToday = input.sent.filter((touch) => isToday(touch.sentAt));
  const sent = sentToday.map((touch): HomeTodayRow => {
    const followup = input.sent.some((other) => other.cardId === touch.cardId && Date.parse(other.sentAt) < Date.parse(touch.sentAt));
    const outcome = outcomeOf(touch);
    return {
      id: touch.id, name: touch.name, company: touch.company, domain: touch.domain ?? "", at: touch.sentAt, time: null,
      note: `${followup ? "Follow-up" : "First email"}${touch.subject && !followup ? `: ${touch.subject}` : ""} · ${OUTCOME_NOTE[outcome]}`,
      tone: outcome === "bounced" ? "warn" : outcome === "interested" || outcome === "replied" ? "good" : "plain", href: card(touch.cardId, touch.domain), followup,
    };
  });
  const queue = input.queue.map((email): HomeTodayRow => ({
    id: email.id, name: email.name, company: email.company, domain: email.domain, at: null, time: email.time,
    note: `${email.subject || "No subject"}${email.status === "approved" ? "" : " · Not reviewed yet"}`, tone: "plain", href: card(email.id, email.domain),
  }));
  const replies = input.replies.filter((item) => isToday(item.repliedAt)).map((item): HomeTodayRow => ({
    id: `r-${item.cardId}-${item.repliedAt}`, name: item.name, company: item.company, domain: item.domain, at: item.repliedAt, time: null,
    note: `${REPLY_NOTE[item.classification] ?? "Replied"}${item.snippet ? `: “${item.snippet.slice(0, 120)}”` : ""}`,
    tone: POSITIVE.includes(item.classification) ? "good" : "plain", href: card(item.cardId, item.domain), gmailUrl: item.gmailUrl,
  }));
  const linkedin = input.linkedin.filter((done) => isToday(done.sentAt)).map((done): HomeTodayRow => ({
    id: done.id, name: done.name, company: done.company, domain: done.domain ?? "", at: done.sentAt, time: null,
    note: LINKEDIN_NOTE[done.channel] ?? "Message", tone: "plain", href: done.domain ? `/accounts/${encodeURIComponent(done.domain)}` : null,
  }));
  const seen = new Set<string>();
  const bounces = input.bounces.filter((row) => isToday(row.bounced_at) && !seen.has(row.id) && Boolean(seen.add(row.id))).map((row): HomeTodayRow => {
    // A fixed address reopens the card and clears "invalid", so the email is back in the queue.
    const open = row.cards?.status === "sent" && row.people?.email_status === "invalid";
    return {
      id: row.id, name: row.people?.full_name ?? "", company: row.cards?.accounts?.name ?? "", domain: row.cards?.accounts?.domain ?? "", at: row.bounced_at, time: null,
      note: open ? `${row.people?.email ?? "The address"} didn't arrive` : `Fixed: now ${row.people?.email ?? "a new address"}, back in the queue`,
      tone: open ? "warn" : "plain", href: card(row.card_id, row.cards?.accounts?.domain), fix: open ? { personId: row.person_id, email: row.people?.email ?? null } : undefined,
    };
  });
  // The ones still to fix come first.
  bounces.sort((x, y) => Number(Boolean(y.fix)) - Number(Boolean(x.fix)));
  return { sent, queue, replies, linkedin, bounces };
}
