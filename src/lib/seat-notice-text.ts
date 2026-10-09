/**
 * The short emails Night Watch sends a seat about its own outreach: the morning heads-up, the late-morning
 * recap, a reply alert and the Friday results note. Pure, so every line is tested; seat-notices.ts sends them.
 */

export type Notice = { subject: string; text: string; html: string };
type Line = string | { href: string; label: string };

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Paragraphs and bullet groups, as plain text and as simple HTML. */
function render(subject: string, blocks: Array<Line | Line[]>): Notice {
  const textOf = (line: Line) => (typeof line === "string" ? line : `${line.label}: ${line.href}`);
  const htmlOf = (line: Line) => (typeof line === "string" ? escapeHtml(line) : `<a href="${escapeHtml(line.href)}">${escapeHtml(line.label)}</a>`);
  const text = blocks.map((block) => (Array.isArray(block) ? block.map((line) => `- ${textOf(line)}`).join("\n") : textOf(block))).join("\n\n");
  const html = `<div style="font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#1a1712">${blocks.map((block) => Array.isArray(block)
    ? `<ul style="margin:0 0 14px;padding-left:20px">${block.map((line) => `<li>${htmlOf(line)}</li>`).join("")}</ul>`
    : `<p style="margin:0 0 14px">${htmlOf(block)}</p>`).join("")}</div>`;
  return { subject, text, html };
}

export type QueuedPerson = { time: string | null; name: string; title: string; company: string };

/** Before the window opens: who auto-send will email today, with a way to keep or skip. */
export function headsUpNotice(input: { first: string; going: QueuedPerson[]; window: string; later: number; link: string }): Notice {
  const shown = input.going.slice(0, 25);
  return render(`Auto-send today: ${plural(input.going.length, "email", "emails")}, ${input.window}`, [
    `Good morning ${input.first}. Auto-send will email ${plural(input.going.length, "person", "people")} from your Gmail today, ${input.window} Eastern:`,
    shown.map((person) => `${person.time ? `${person.time}: ` : ""}${person.name}${person.title ? `, ${person.title}` : ""} at ${person.company}`),
    ...(input.going.length > shown.length ? [`and ${input.going.length - shown.length} more.`] : []),
    ...(input.later ? [`${plural(input.later, "more waits", "more wait")} for the next send days (daily limit).`] : []),
    "To keep any of them for yourself, read one first, or skip today:",
    { href: input.link, label: "Open Auto-send" },
  ]);
}

export type SentPerson = { name: string; company: string; outcome: string };

/** After the window: what went out this morning and how it is doing so far. */
export function recapNotice(input: { first: string; sent: SentPerson[]; replies: number; bounced: number; cap: number; link: string }): Notice {
  return render(`Auto-send recap: ${plural(input.sent.length, "email", "emails")} sent this morning`, [
    `${input.first}, ${plural(input.sent.length, "email", "emails")} went out this morning (your limit is ${input.cap} a day). So far: ${plural(input.replies, "reply", "replies")}, ${input.bounced} bounced.`,
    input.sent.slice(0, 40).map((person) => `${person.name} at ${person.company}: ${person.outcome}`),
    { href: input.link, label: "See what was sent" },
  ]);
}

const REPLY_WORDS: Record<string, string> = { positive: "interested", referral: "pointing you to someone else", neutral: "replied", objection: "pushing back", negative: "not interested", meeting: "booked a meeting" };

/** A person replied: who, how it reads, and the call brief one click away. */
export function replyNotice(input: { name: string; title: string | null; company: string; classification: string; snippet: string; briefLink: string; historyLink: string }): Notice {
  const reads = REPLY_WORDS[input.classification] ?? "replied";
  const snippet = input.snippet.replace(/\s+/g, " ").trim().slice(0, 400);
  return render(`Reply from ${input.name} (${input.company}): ${reads}`, [
    `${input.name}${input.title ? `, ${input.title}` : ""} at ${input.company} replied. It reads as: ${reads}.`,
    ...(snippet ? [`“${snippet}${input.snippet.length > 400 ? "…" : ""}”`] : []),
    "Follow-ups to them have stopped. Reply from your Gmail thread as usual.",
    [{ href: input.briefLink, label: "Call brief" }, { href: input.historyLink, label: "The whole conversation in History" }],
  ]);
}

/** Friday: the week's sending in one note. */
export function weeklyNotice(input: { first: string; sent: number; firsts: number; followups: number; replies: number; interested: number; bounced: number; replyRate: number; bounceRate: number; topIndustries: Array<{ label: string; count: number }>; interestedPeople: SentPerson[]; link: string }): Notice {
  return render(`Your week: ${plural(input.sent, "email", "emails")}, ${plural(input.replies, "reply", "replies")}, ${input.interested} interested`, [
    `${input.first}, here is your week in Night Watch.`,
    [
      `Sent: ${input.sent} (${plural(input.firsts, "first email", "first emails")}, ${plural(input.followups, "follow-up", "follow-ups")})`,
      `Replies: ${input.replies} (${input.replyRate}% of emails sent)`,
      `Interested: ${input.interested}`,
      `Bounced: ${input.bounced} (${input.bounceRate}%)`,
    ],
    ...(input.interestedPeople.length ? ["Interested this week:", input.interestedPeople.map((person) => `${person.name} at ${person.company}`)] : []),
    ...(input.topIndustries.length ? [`Most replies came from: ${input.topIndustries.slice(0, 3).map((item) => `${item.label} (${item.count})`).join(", ")}.`] : []),
    { href: input.link, label: "See it all" },
  ]);
}
