import { outcomeOf, shiftDate, type SentTouch } from "./sent-stats.ts";

/** One day of sending: every email, the first emails among them, and what came back. */
export type SeriesDay = { date: string; sent: number; firsts: number; replies: number; interested: number; bounced: number };
export type Funnel = { emailed: number; replied: number; interested: number; meetings: number };

const replied = (outcome: string) => outcome === "replied" || outcome === "interested";

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
