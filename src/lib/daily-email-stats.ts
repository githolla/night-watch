import type { DayPoint, Insight } from "./daily-email.ts";
import { isSendDay } from "./morning-send-rules.ts";
import { outcomeOf, sentStats, shiftDate, type SentTouch } from "./sent-stats.ts";

const REAL_REPLY = new Set(["positive", "referral", "neutral", "objection", "negative"]);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const shortDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

/** The send day before `date` (Friday on a Monday), skipping weekends and skipped dates. */
export function previousSendDay(date: string) {
  let day = shiftDate(date, -1);
  for (let guard = 0; guard < 10 && !isSendDay(weekdayOf(day), day); guard++) day = shiftDate(day, -1);
  return day;
}
export function nextSendDay(date: string) {
  let day = shiftDate(date, 1);
  for (let guard = 0; guard < 10 && !isSendDay(weekdayOf(day), day); guard++) day = shiftDate(day, 1);
  return day;
}

/** Emails sent each day and replies received each day (by when they came in), for the last `days` days. */
export function chartDays(touches: SentTouch[], today: string, dayOf: (iso: string) => string, days = 14): DayPoint[] {
  const out: DayPoint[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = shiftDate(today, -back);
    out.push({ date, label: back === 0 ? "Today" : shortDay(date), sent: 0, replies: 0 });
  }
  const byDate = new Map(out.map((day) => [day.date, day]));
  for (const touch of touches) {
    const sent = byDate.get(dayOf(touch.sentAt));
    if (sent) sent.sent++;
    if (touch.replyAt && REAL_REPLY.has(touch.replyClass ?? "")) {
      const replied = byDate.get(dayOf(touch.replyAt));
      if (replied) replied.replies++;
    }
  }
  return out;
}

/**
 * What the numbers say, only where there is enough to say it: replies over the last two weeks against the two
 * before, which sectors and which email versions reply, and a bounce rate worth acting on.
 */
export function insightsFrom(touches: SentTouch[], today: string, dayOf: (iso: string) => string, links: { sent: string; results: string }): Insight[] {
  const out: Insight[] = [];
  const replied = (touch: SentTouch) => Boolean(touch.replyAt && REAL_REPLY.has(touch.replyClass ?? ""));
  const between = (from: number, to: number) => touches.filter((touch) => { const day = dayOf(touch.sentAt); return day > shiftDate(today, -from) && day <= shiftDate(today, -to); });
  const recent = between(14, 0), before = between(28, 14);
  if (recent.length >= 10) {
    const now = pct(recent.filter(replied).length, recent.length), then = pct(before.filter(replied).length, before.length);
    const trend = before.length >= 10 ? (now > then ? `, up from ${then}% the two weeks before` : now < then ? `, down from ${then}% the two weeks before` : ", the same as the two weeks before") : "";
    out.push({ title: `${now}% of emails from the last two weeks got a reply`, text: `${recent.filter(replied).length} replies from ${recent.length} emails${trend}.`, href: links.results });
  }
  const stats = sentStats(touches, 60, today, dayOf);
  const firsts = stats.recent.filter((row) => !row.followup);
  const bySector = new Map<string, { sent: number; replies: number }>();
  for (const row of firsts) {
    const group = bySector.get(row.industry) ?? { sent: 0, replies: 0 };
    group.sent++;
    if (row.outcome === "replied" || row.outcome === "interested") group.replies++;
    bySector.set(row.industry, group);
  }
  const sectors = [...bySector].filter(([, group]) => group.sent >= 8).map(([label, group]) => ({ label, rate: pct(group.replies, group.sent), ...group })).sort((a, b) => b.rate - a.rate || b.sent - a.sent);
  if (sectors.length >= 2 && sectors[0].replies > 0) {
    out.push({ title: `${sectors[0].label} replies most`, text: `Reply rate on first emails by sector, last 60 days (sectors with 8 or more emails).`, href: links.results, bars: sectors.slice(0, 5).map((sector) => ({ label: sector.label, value: sector.rate, display: `${sector.rate}% of ${sector.sent}` })) });
  }
  const versions = stats.versions.filter((version) => version.label !== "Not recorded" && version.sent >= 8);
  if (versions.length >= 2 && versions.some((version) => version.replies > 0)) {
    const best = [...versions].sort((a, b) => b.replyRate - a.replyRate)[0];
    out.push({ title: `The ${best.label} version gets the most replies`, text: "Reply rate by email version, first emails over the last 60 days.", href: links.results, bars: versions.slice(0, 4).map((version) => ({ label: version.label, value: version.replyRate, display: `${version.replyRate}% of ${version.sent}` })) });
  }
  const week = between(7, 0);
  const bounced = week.filter((touch) => outcomeOf(touch) === "bounced").length;
  if (week.length >= 10 && pct(bounced, week.length) >= 3) {
    out.push({ title: `${bounced} of ${week.length} emails bounced this week`, text: "Bounces come from addresses nobody confirmed. Fixing them keeps your mailbox in good standing.", href: links.sent });
  }
  return out;
}
