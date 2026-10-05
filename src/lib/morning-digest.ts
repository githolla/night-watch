/**
 * The morning email each person gets about their own seat: who replied, meetings coming up, what is waiting
 * to send and what went out yesterday. Built from plain numbers so it can be tested without a database, and
 * null when there is nothing worth reading, so nobody gets a "0 cards" email.
 */
export type DigestReply = { name: string; company: string; kind: string };
export type DigestMeeting = { name: string; company: string; at: string };
export type DigestData = {
  seat: string;
  replies: DigestReply[];
  meetings: DigestMeeting[];
  /** Companies on today's list, or null when there is no list today. */
  todaysList: number | null;
  /** Today's list companies not sent yet. */
  todaysUnsent: number;
  /** The First 25 batch: how many of its companies have been emailed. */
  firstBatch: { sent: number; total: number } | null;
  followupsToday: number;
  sentYesterday: number;
  bouncedYesterday: number;
  links: { desk: string; today: string; first: string; followups: string };
  timeZone?: string;
  /** False on a weekend or holiday: only news (replies, meetings, bounces) is worth an email then, not reminders. */
  sendDay?: boolean;
};

const REPLY_WORDS: Record<string, string> = {
  positive: "interested", referral: "pointed you to someone else", objection: "pushed back", ooo: "out of office",
  negative: "not interested", neutral: "replied",
};
const replyWord = (kind: string) => REPLY_WORDS[kind] ?? "replied";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function meetingTime(at: string, timeZone: string) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

/** True when the email would only say that nothing happened. */
export function digestIsEmpty(data: DigestData) {
  if (data.sendDay === false) return !data.replies.length && !data.meetings.length && !data.bouncedYesterday;
  const batchOpen = data.firstBatch !== null && data.firstBatch.sent < data.firstBatch.total;
  return !data.replies.length && !data.meetings.length && !(data.todaysList && data.todaysUnsent) && !batchOpen && !data.followupsToday && !data.sentYesterday && !data.bouncedYesterday;
}

/** The subject leads with the most important news: replies, then meetings, then what is waiting. */
export function digestSubject(data: DigestData) {
  const positive = data.replies.filter((reply) => reply.kind === "positive" || reply.kind === "referral");
  if (positive.length === 1) return `${positive[0].name} at ${positive[0].company} is ${replyWord(positive[0].kind)}`;
  if (data.replies.length) return `${plural(data.replies.length, "new reply", "new replies")}${data.meetings.length ? ` and ${plural(data.meetings.length, "meeting")} ahead` : ""}`;
  if (data.meetings.length) return data.meetings.length === 1 ? `Meeting ${meetingTime(data.meetings[0].at, data.timeZone ?? "America/New_York")} with ${data.meetings[0].name}` : `${data.meetings.length} meetings ahead`;
  if (data.todaysList && data.todaysUnsent) return `${plural(data.todaysUnsent, "company", "companies")} ready for you today`;
  if (data.firstBatch && data.firstBatch.sent < data.firstBatch.total) return `First 25: ${data.firstBatch.total - data.firstBatch.sent} left to send`;
  if (data.followupsToday) return `${plural(data.followupsToday, "follow-up")} going out today`;
  return `Yesterday: ${plural(data.sentYesterday, "email")} sent`;
}

type Section = { title: string; lines: string[]; link?: { label: string; url: string } };

function sections(data: DigestData): Section[] {
  const zone = data.timeZone ?? "America/New_York";
  const out: Section[] = [];
  if (data.replies.length) {
    out.push({
      title: data.replies.length === 1 ? "A reply came in" : `${data.replies.length} replies came in`,
      lines: data.replies.map((reply) => `${reply.name}, ${reply.company}: ${replyWord(reply.kind)}`),
      link: { label: `Read ${data.replies.length === 1 ? "it" : "them"} in Gmail and answer from there`, url: "https://mail.google.com/mail/u/0/#inbox" },
    });
  }
  if (data.meetings.length) out.push({ title: data.meetings.length === 1 ? "Meeting ahead" : "Meetings ahead", lines: data.meetings.map((meeting) => `${meetingTime(meeting.at, zone)}: ${meeting.name}, ${meeting.company}`) });
  const today: string[] = [];
  if (data.todaysList && data.todaysUnsent) today.push(`${plural(data.todaysUnsent, "company", "companies")} on today's list ${data.todaysUnsent === 1 ? "is" : "are"} drafted and waiting for you.`);
  if (data.firstBatch && data.firstBatch.sent < data.firstBatch.total) {
    const { sent, total } = data.firstBatch;
    today.push(sent ? `First 25: ${sent} of ${total} sent, ${total - sent} to go.` : `First 25: all ${total} are drafted and waiting for you.`);
  }
  if (data.followupsToday) today.push(`${plural(data.followupsToday, "follow-up")} will go out on ${data.followupsToday === 1 ? "its" : "their"} own today.`);
  if (today.length) {
    const link = data.todaysList && data.todaysUnsent ? { label: "Open today's list", url: data.links.today } : data.firstBatch && data.firstBatch.sent < data.firstBatch.total ? { label: "Open your First 25", url: data.links.first } : { label: "See follow-ups", url: data.links.followups };
    out.push({ title: "Today", lines: today, link });
  }
  if (data.sentYesterday || data.bouncedYesterday) {
    const line = `You sent ${plural(data.sentYesterday, "email")}${data.bouncedYesterday ? `, and ${plural(data.bouncedYesterday, "address", "addresses")} bounced. Night Watch will not write to ${data.bouncedYesterday === 1 ? "it" : "them"} again` : ""}.`;
    out.push({ title: "Yesterday", lines: [line] });
  }
  return out;
}

/** The finished email, or null when there is nothing to report. */
export function digestEmail(data: DigestData): { subject: string; text: string; html: string } | null {
  if (digestIsEmpty(data)) return null;
  const parts = sections(data);
  const first = data.seat.split(/\s+/)[0];
  const text = [
    `Good morning, ${first}.`,
    ...parts.map((part) => [part.title.toUpperCase(), ...part.lines.map((line) => `- ${line}`), ...(part.link ? [`${part.link.label}: ${part.link.url}`] : [])].join("\n")),
    `Night Watch: ${data.links.desk}`,
  ].join("\n\n");
  const html = `<div style="font:400 15px/1.6 Arial,Helvetica,sans-serif;color:#1a1712;max-width:560px">
<p style="margin:0 0 18px;font-size:17px">Good morning, ${esc(first)}.</p>
${parts.map((part) => `<div style="margin:0 0 20px;padding:14px 16px;border:1px solid #e6e0d6;border-radius:10px;background:#fbf9f5">
<div style="font:700 11px/1 Arial,Helvetica,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#8a6d3b;margin-bottom:8px">${esc(part.title)}</div>
${part.lines.map((line) => `<div style="margin:4px 0">${esc(line)}</div>`).join("\n")}
${part.link ? `<div style="margin-top:10px"><a href="${esc(part.link.url)}" style="color:#7a5a1f;font-weight:600">${esc(part.link.label)} &rarr;</a></div>` : ""}
</div>`).join("\n")}
<p style="margin:0;font-size:12px;color:#8a8378"><a href="${esc(data.links.desk)}" style="color:#8a8378">Open Night Watch</a>. This email skips any morning with nothing to report.</p>
</div>`;
  return { subject: digestSubject(data), text, html };
}
