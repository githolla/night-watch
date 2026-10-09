/**
 * What went out recently and how it is doing, for the Drafts "Recently sent" tab. Pure: the page loads the
 * touches and passes a day function in the send time zone, so the same numbers come out in a test.
 */

export type SentTouch = {
  id: string; cardId: string; sentAt: string;
  replyAt: string | null; replyClass: string | null; bouncedAt: string | null;
  name: string; title: string; company: string; subject: string;
  industry: string; role: string; size: string;
};
export type SentRow = SentTouch & { followup: boolean; outcome: "interested" | "replied" | "bounced" | "out of office" | "sent" };
export type SentStats = {
  days: number;
  sent: number; firsts: number; followups: number;
  replies: number; interested: number; bounced: number;
  replyRate: number; bounceRate: number;
  /** One bar per day of the period (at most the last 14), oldest first. */
  daily: Array<{ date: string; label: string; sent: number; replies: number }>;
  mix: { industry: Array<{ label: string; count: number }>; role: Array<{ label: string; count: number }>; size: Array<{ label: string; count: number }> };
  recent: SentRow[];
};

/** Replies a person wrote, not an auto-responder. */
const REAL_REPLY = new Set(["positive", "neutral", "objection", "referral", "negative"]);
const tallyOf = (labels: string[]) => {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
};
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export function outcomeOf(touch: Pick<SentTouch, "replyAt" | "replyClass" | "bouncedAt">): SentRow["outcome"] {
  if (touch.bouncedAt) return "bounced";
  if (touch.replyAt && (touch.replyClass === "positive" || touch.replyClass === "referral")) return "interested";
  if (touch.replyAt && touch.replyClass === "ooo") return "out of office";
  if (touch.replyAt && REAL_REPLY.has(touch.replyClass ?? "")) return "replied";
  return "sent";
}

/**
 * `touches` may reach further back than the period: a card's earlier email is what makes a later one a
 * follow-up. `dayOf` turns a timestamp into its YYYY-MM-DD in the send time zone; `today` is that date now.
 */
export function sentStats(touches: SentTouch[], days: number, today: string, dayOf: (iso: string) => string): SentStats {
  const firstByCard = new Map<string, string>();
  for (const touch of [...touches].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) if (!firstByCard.has(touch.cardId)) firstByCard.set(touch.cardId, touch.id);
  const dates: string[] = [];
  for (let back = Math.min(days, 14) - 1; back >= 0; back--) dates.push(shiftDate(today, -back));
  const since = shiftDate(today, -(days - 1));
  const inPeriod = touches.filter((touch) => dayOf(touch.sentAt) >= since).sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  const rows: SentRow[] = inPeriod.map((touch) => ({ ...touch, followup: firstByCard.get(touch.cardId) !== touch.id, outcome: outcomeOf(touch) }));
  const firsts = rows.filter((row) => !row.followup);
  const replies = rows.filter((row) => row.outcome === "replied" || row.outcome === "interested").length;
  const bounced = rows.filter((row) => row.outcome === "bounced").length;
  return {
    days, sent: rows.length, firsts: firsts.length, followups: rows.length - firsts.length,
    replies, interested: rows.filter((row) => row.outcome === "interested").length, bounced,
    replyRate: pct(replies, rows.length), bounceRate: pct(bounced, rows.length),
    daily: dates.map((date) => ({
      date, label: date === today ? "Today" : new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
      sent: rows.filter((row) => dayOf(row.sentAt) === date).length,
      replies: rows.filter((row) => dayOf(row.sentAt) === date && (row.outcome === "replied" || row.outcome === "interested")).length,
    })),
    // Who the first emails went to; a follow-up is the same person again.
    mix: { industry: tallyOf(firsts.map((row) => row.industry)), role: tallyOf(firsts.map((row) => row.role)), size: tallyOf(firsts.map((row) => row.size)) },
    recent: rows.slice(0, 100),
  };
}

export function shiftDate(date: string, deltaDays: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}
