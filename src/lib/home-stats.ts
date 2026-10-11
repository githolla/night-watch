import { outcomeOf, shiftDate, type SentTouch } from "./sent-stats.ts";

/** One day of sending: every email, the first emails among them, and what came back. */
export type SeriesDay = { date: string; sent: number; firsts: number; replies: number; interested: number; bounced: number };
export type Breakdown = { label: string; sent: number; replies: number; interested: number; rate: number };
export type ActivityEvent = { kind: "sent" | "replied" | "interested" | "bounced"; at: string; name: string; company: string; cardId: string; followup: boolean };
export type Funnel = { emailed: number; replied: number; interested: number; meetings: number };

const replied = (outcome: string) => outcome === "replied" || outcome === "interested";
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

/** The first email on each card, so a later one counts as a follow-up. */
function firstIds(touches: SentTouch[]): Set<string> {
  const first = new Map<string, SentTouch>();
  for (const touch of touches) {
    const seen = first.get(touch.cardId);
    if (!seen || touch.sentAt < seen.sentAt) first.set(touch.cardId, touch);
  }
  return new Set([...first.values()].map((touch) => touch.id));
}

/** One entry per day for the last `days` days, oldest first, every day present even when nothing went out. */
export function dailySeries(touches: SentTouch[], days: number, today: string, dayOf: (iso: string) => string): SeriesDay[] {
  const firsts = firstIds(touches);
  const byDay = new Map<string, SeriesDay>();
  for (let back = days - 1; back >= 0; back--) {
    const date = shiftDate(today, -back);
    byDay.set(date, { date, sent: 0, firsts: 0, replies: 0, interested: 0, bounced: 0 });
  }
  for (const touch of touches) {
    const day = byDay.get(dayOf(touch.sentAt));
    if (!day) continue;
    const outcome = outcomeOf(touch);
    day.sent++;
    if (firsts.has(touch.id)) day.firsts++;
    if (replied(outcome)) day.replies++;
    if (outcome === "interested") day.interested++;
    if (outcome === "bounced") day.bounced++;
  }
  return [...byDay.values()];
}

/** First emails since a date, grouped by industry, role or size, with how many got a reply. Most sent first. */
export function breakdown(touches: SentTouch[], key: "industry" | "role" | "size", since: string, dayOf: (iso: string) => string): Breakdown[] {
  const firsts = firstIds(touches);
  const groups = new Map<string, Breakdown>();
  for (const touch of touches) {
    if (!firsts.has(touch.id) || dayOf(touch.sentAt) < since) continue;
    const label = touch[key] || "Other";
    const group = groups.get(label) ?? { label, sent: 0, replies: 0, interested: 0, rate: 0 };
    const outcome = outcomeOf(touch);
    group.sent++;
    if (replied(outcome)) group.replies++;
    if (outcome === "interested") group.interested++;
    groups.set(label, group);
  }
  return [...groups.values()].map((group) => ({ ...group, rate: pct(group.replies, group.sent) })).sort((a, b) => b.sent - a.sent || a.label.localeCompare(b.label));
}

/** The latest sends, replies and bounces, newest first. */
export function recentActivity(touches: SentTouch[], limit: number): ActivityEvent[] {
  const firsts = firstIds(touches);
  const events: ActivityEvent[] = [];
  for (const touch of touches) {
    const base = { name: touch.name, company: touch.company, cardId: touch.cardId, followup: !firsts.has(touch.id) };
    events.push({ ...base, kind: "sent", at: touch.sentAt });
    const outcome = outcomeOf(touch);
    if (touch.replyAt && replied(outcome)) events.push({ ...base, kind: outcome === "interested" ? "interested" : "replied", at: touch.replyAt });
    if (touch.bouncedAt) events.push({ ...base, kind: "bounced", at: touch.bouncedAt });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/** People emailed since a date and how far they got. Meetings come from the cards, which a reply alone does not move. */
export function funnel(touches: SentTouch[], since: string, dayOf: (iso: string) => string, meetings: number): Funnel {
  const firsts = firstIds(touches);
  const cards = new Map<string, string>();
  for (const touch of touches) {
    if (dayOf(touch.sentAt) < since) continue;
    const outcome = outcomeOf(touch);
    const before = cards.get(touch.cardId);
    if (firsts.has(touch.id) && !before) cards.set(touch.cardId, "sent");
    if (cards.has(touch.cardId) && replied(outcome) && cards.get(touch.cardId) !== "interested") cards.set(touch.cardId, outcome);
  }
  const outcomes = [...cards.values()];
  return { emailed: outcomes.length, replied: outcomes.filter(replied).length, interested: outcomes.filter((outcome) => outcome === "interested").length, meetings };
}
