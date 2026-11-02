import { activityAnalytics } from "./activity-analytics.ts";
import { localParts } from "./local-time.ts";
import type { SlackBlock } from "./slack.ts";

export type ActivityStats = ReturnType<typeof activityAnalytics>;
export type ActivitySchedule = { date: string; owner: string; emailFollowups: number; calls: number };
export type ActivityBrief = {
  day: string; generatedAt: string; weekStart: string; weekEnd: string;
  lastWeek: ActivityStats; yesterday: ActivityStats; today: ActivityStats;
  schedule: ActivitySchedule[]; overdueEmails: number; overdueCalls: number; failedEmails: number;
  controls: Array<{ owner: string; blocker: string | null; dailyCap: number; newEmails: number; newEmailDay: string; held: number }>;
  callEnabled: boolean; callDailyLimit: number;
};
export function shiftReportDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function activityBriefDates(day: string) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const thisMonday = shiftReportDay(day, -((weekday + 6) % 7));
  return { weekStart: shiftReportDay(thisMonday, -7), weekEnd: thisMonday, yesterday: shiftReportDay(day, -1), tomorrow: shiftReportDay(day, 1), horizon: shiftReportDay(day, 7) };
}
const dateLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const name = (owner: string) => owner === "josh" ? "Josh" : "Suuchi";
const total = (stats: ActivityStats, key: keyof Omit<ActivityStats[number], "owner">) => stats.reduce((sum, seat) => sum + seat[key], 0);
function periodText(title: string, stats: ActivityStats) {
  return [`*${title}*`,
    `*${total(stats, "emailsSent")} emails*  ·  *${total(stats, "callsMade")} calls*  ·  *${total(stats, "voicemailMessagesAttempted")} VM attempts*  ·  *${total(stats, "meetingsConfirmed")} call bookings*`,
    ...stats.map(s => `*${name(s.owner)}*\nEmail: ${s.emailsSent} sent · ${s.replies} replied · ${s.bounces} bounced\nPhone: ${s.callsMade} dialed · ${s.intendedPerson} contacts reached · ${s.receptionists} receptionists\nVM: ${s.voicemailReached} systems reached · ${s.voicemailMessagesAttempted} messages attempted\nOutcomes: ${s.noAnswer} no answer · ${s.switchboardBlocked} menus unresolved · ${s.technicalFailures} technical issues\n${s.meetingsConfirmed} booked · ${s.declined} declined · ${s.optedOut} opted out · ${s.needsReview} need review`),
  ].join("\n\n");
}
export function activityBriefSlack(brief: ActivityBrief, base: string) {
  const time = new Date(brief.generatedAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const sections = [
    periodText(`TODAY SO FAR | ${dateLabel(brief.day)} · ${time} ET`, brief.today),
    periodText(`YESTERDAY | ${dateLabel(shiftReportDay(brief.day, -1))}`, brief.yesterday),
    periodText(`LAST WEEK | ${dateLabel(brief.weekStart)} to ${dateLabel(shiftReportDay(brief.weekEnd, -1))}`, brief.lastWeek),
  ];
  const dates = [...new Set(brief.schedule.map(row => row.date))].sort();
  const upcoming = ["*SCHEDULED | next 7 days*", ...dates.map(day => {
    const rows = brief.schedule.filter(row => row.date === day);
    return `*${dateLabel(day)}*\n${["josh", "suuchi"].map(owner => { const row = rows.find(row => row.owner === owner); return `${name(owner)}: ${row?.emailFollowups ?? 0} email follow-ups due · ${row?.calls ?? 0} calls queued`; }).join("\n")}`;
  }), ...brief.controls.map(c => `${name(c.owner)}: ${c.newEmails} new intro emails planned ${dateLabel(c.newEmailDay)} · ${c.dailyCap}/day email cap${c.blocker ? ` · ${c.blocker}` : " · auto-send on"}`),
    `Calls: ${brief.callEnabled ? "automatic dialing on" : "automatic dialing off"} · ${brief.callDailyLimit}/day shared limit`,
    `Carryover: ${brief.overdueEmails} overdue email steps · ${brief.overdueCalls} overdue queued calls · ${brief.failedEmails} failed email steps requiring attention`,
    "Email counts are due steps, before daily limits and final reply, bounce and opt-out checks. New intro plans cover the next sending window only. New sent emails can add calls automatically.",
  ].join("\n\n");
  sections.push(upcoming);
  const current = brief.today.map(s => `${name(s.owner)}: ${s.queued} calls queued · ${s.active} active`).join("  |  ");
  const footer = `All dates are Eastern. Last week is the previous Monday through Sunday. Internal test calls excluded. Replies and bounces count contacts within each period. Sent does not confirm inbox delivery; VM attempts are not confirmed recordings.\n<${base}/engagement|Outreach overview> · <${base}/calls|Calls and transcripts> · <${base}/drafts/sent|Sent emails>`;
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: "Nightwatch | Outreach briefing" } },
    { type: "context", elements: [{ type: "mrkdwn", text: `Updated ${dateLabel(brief.day)} at ${time} ET · ${current}` }] },
    ...sections.flatMap(text => [{ type: "divider" }, { type: "section", text: { type: "mrkdwn", text } }]),
    { type: "context", elements: [{ type: "mrkdwn", text: footer }] },
  ];
  return { text: [`Nightwatch | Outreach briefing`, ...sections, footer].join("\n\n"), blocks };
}
export const reportDay = (at: string) => localParts(new Date(at), "America/New_York").date;
