/**
 * The morning and evening emails each seat gets about its own outreach. Built from plain data so they can be
 * tested and previewed without a database. Gmail strips styles in <head> and ignores flexbox, so every chart is
 * a table with inline styles, and every number links into the app.
 */
export type Tone = "good" | "warn" | "plain";
export type DayPoint = { date: string; label: string; sent: number; replies: number };
export type Tile = { label: string; value: number; note: string; tone: Tone; href: string };
export type PersonRow = {
  name: string; company: string; domain: string; note: string; tone: Tone; href: string; time?: string;
  /** Whose initials go in the circle, when the row's company field holds something else. */
  badge?: string;
};
export type Insight = { title: string; text: string; href: string; bars?: Array<{ label: string; value: number; display: string }> };
export type Need = { text: string; action: string; href: string };
export type SendState = "on" | "off" | "paused";
export type ListCompany = { company: string; domain: string; sector: string; buyer: string; title: string; address: "confirmed" | "unconfirmed" | "missing"; href: string };

export type MorningData = {
  first: string; dateLabel: string; appHref: string;
  send: { state: SendState; going: number; window: string; dayLabel: string; queue: PersonRow[]; href: string };
  list: { dateLabel: string; companies: ListCompany[]; sectors: Array<{ label: string; value: number }>; href: string } | null;
  yesterday: { label: string; tiles: Tile[] };
  chart: DayPoint[];
  insights: Insight[];
  needs: Need[];
  meetings: Array<{ name: string; company: string; when: string; href: string }>;
  /** False on a weekend or holiday: the email then goes only when there is news. */
  sendDay: boolean;
};

export type EveningData = {
  first: string; dateLabel: string; appHref: string;
  tiles: Tile[];
  sent: PersonRow[]; sentHref: string;
  replies: PersonRow[]; repliesHref: string;
  chart: DayPoint[];
  tomorrow: { state: SendState; going: number; window: string; dayLabel: string; followups: number; unread: number; href: string };
  tonight: { building: boolean; listDayLabel: string; region: string; sectors: string[]; perSeat: number; listed: number; note: string };
  needs: Need[];
};

const C = { ink: "#1f1b16", muted: "#7b7468", line: "#e8e2d8", soft: "#f6f3ec", card: "#ffffff", page: "#efebe3", accent: "#9a6a27", accentSoft: "#f3e7d3", ok: "#2f6f5e", okSoft: "#e6f1ec", warn: "#b4542f", warnSoft: "#f8e6dd", bar: "#cdb48a" };
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const toneColor = (tone: Tone) => (tone === "good" ? C.ok : tone === "warn" ? C.warn : C.ink);
// A colored circle with the company's initials: it looks the same in every mail app, where a logo image can be
// missing (most small companies have none) or blocked.
const BADGE = ["#9a6a27", "#2f6f5e", "#7a5c8e", "#b4542f", "#4f6d8f", "#6b7d3a", "#8a5a44", "#3f7c85"];
const initials = (name: string) => esc(name.split(/\s+/).filter((word) => /^[a-z0-9]/i.test(word)).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?");
const logo = (domain: string, name: string) => {
  const key = (domain || name).toLowerCase();
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `<div style="width:26px;height:26px;border-radius:13px;background:${BADGE[hash % BADGE.length]};color:#ffffff;font:700 10px/26px ${FONT};text-align:center;letter-spacing:0.02em">${initials(name)}</div>`;
};

function link(href: string, label: string, color = C.accent) {
  return `<a href="${esc(href)}" style="color:${color};font-weight:600;text-decoration:none">${esc(label)}&nbsp;&rarr;</a>`;
}

function button(href: string, label: string) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${C.ink};color:#ffffff;font:600 14px/1 ${FONT};padding:12px 18px;border-radius:8px;text-decoration:none">${esc(label)}</a>`;
}

/** A white card with a small uppercase heading and an optional link at the bottom. */
function card(title: string, body: string, footer?: { href: string; label: string }, meta?: string) {
  return `<tr><td style="padding:0 0 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px">
<tr><td style="padding:18px 20px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="font:700 11px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.accent}">${esc(title)}</td>
${meta ? `<td align="right" style="font:400 12px/1.4 ${FONT};color:${C.muted}">${esc(meta)}</td>` : ""}
</tr></table></td></tr>
<tr><td style="padding:8px 20px ${footer ? "8px" : "18px"};font:400 14px/1.55 ${FONT};color:${C.ink}">${body}</td></tr>
${footer ? `<tr><td style="padding:4px 20px 18px;font:400 14px/1.4 ${FONT}">${link(footer.href, footer.label)}</td></tr>` : ""}
</table></td></tr>`;
}

/** Big numbers side by side, each one a link. */
function tiles(items: Tile[]) {
  const width = Math.floor(100 / Math.max(1, items.length));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${items.map((item) => `<td width="${width}%" valign="top" style="padding:4px 4px 8px 0">
<a href="${esc(item.href)}" style="display:block;text-decoration:none;color:${C.ink};background:${item.tone === "warn" && item.value ? C.warnSoft : item.tone === "good" && item.value ? C.okSoft : C.soft};border-radius:10px;padding:12px 10px">
<div style="font:400 12px/1.3 ${FONT};color:${C.muted}">${esc(item.label)}</div>
<div style="font:600 26px/1.15 ${FONT};color:${item.value ? toneColor(item.tone) : C.muted};margin:4px 0 2px">${item.value}</div>
<div style="font:400 11px/1.35 ${FONT};color:${C.muted}">${esc(item.note)}</div></a></td>`).join("")}</tr></table>`;
}

/** 14 days of sending as bars, with replies received each day stacked on top in green. */
function chart(days: DayPoint[]) {
  if (!days.length) return "";
  const max = Math.max(1, ...days.map((day) => day.sent + day.replies));
  const height = 72;
  const px = (value: number) => (value ? Math.max(3, Math.round((value / max) * height)) : 0);
  const sent = days.reduce((total, day) => total + day.sent, 0);
  const replies = days.reduce((total, day) => total + day.replies, 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${days.map((day) => `<td valign="bottom" align="center" style="padding:0 2px;height:${height + 16}px" title="${esc(`${day.label}: ${day.sent} sent, ${day.replies} replies`)}">
<div style="font:600 10px/1 ${FONT};color:${C.muted};padding-bottom:3px">${day.sent || ""}</div>
${day.replies ? `<div style="width:14px;height:${px(day.replies)}px;background:${C.ok};border-radius:3px 3px 0 0;font-size:0;line-height:0">&nbsp;</div>` : ""}
<div style="width:14px;height:${px(day.sent)}px;background:${C.bar};border-radius:${day.replies ? "0" : "3px 3px"} 0 0;font-size:0;line-height:0">&nbsp;</div>
</td>`).join("")}</tr>
<tr>${days.map((day, index) => `<td align="center" style="padding-top:6px;font:400 10px/1 ${FONT};color:${C.muted}">${index % 2 === days.length % 2 ? "" : esc(day.label)}</td>`).join("")}</tr></table>
<div style="font:400 12px/1.5 ${FONT};color:${C.muted};padding-top:10px"><span style="display:inline-block;width:9px;height:9px;background:${C.bar};border-radius:2px"></span> Emails sent (${sent}) &nbsp; <span style="display:inline-block;width:9px;height:9px;background:${C.ok};border-radius:2px"></span> Replies received (${replies})</div>`;
}

/** Horizontal bars, longest first, for a breakdown like sectors or reply rates. */
function bars(items: Array<{ label: string; value: number; display: string }>, color = C.bar) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((item) => `<tr>
<td width="42%" style="padding:3px 8px 3px 0;font:400 12px/1.3 ${FONT};color:${C.ink}">${esc(item.label)}</td>
<td style="padding:3px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="${Math.max(2, Math.round((item.value / max) * 100))}%" style="background:${color};height:10px;border-radius:3px;font-size:0;line-height:0">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table></td>
<td width="56" align="right" style="padding:3px 0 3px 8px;font:600 12px/1.3 ${FONT};color:${C.ink}">${esc(item.display)}</td></tr>`).join("")}</table>`;
}

/** People with their company logo, what happened and when; the name links to the company in the app. */
function people(rows: PersonRow[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.map((row, index) => `<tr>
<td width="32" valign="top" style="padding:9px 0;${index ? `border-top:1px solid ${C.line};` : ""}">${logo(row.domain, row.badge ?? row.company)}</td>
<td valign="top" style="padding:8px 8px 8px 0;${index ? `border-top:1px solid ${C.line};` : ""}">
<a href="${esc(row.href)}" style="font:600 14px/1.35 ${FONT};color:${C.ink};text-decoration:none">${esc(row.name || row.company)}</a>${row.name && row.company ? `<span style="font:400 13px/1.35 ${FONT};color:${C.muted}"> · ${esc(row.company)}</span>` : ""}
<div style="font:400 12px/1.4 ${FONT};color:${row.tone === "plain" ? C.muted : toneColor(row.tone)}">${esc(row.note)}</div></td>
<td width="70" align="right" valign="top" style="padding:9px 0;font:400 12px/1.35 ${FONT};color:${C.muted};${index ? `border-top:1px solid ${C.line};` : ""}">${esc(row.time ?? "")}</td></tr>`).join("")}</table>`;
}

function needs(items: Need[]) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((item, index) => `<tr>
<td style="padding:9px 8px 9px 0;font:400 14px/1.4 ${FONT};color:${C.ink};${index ? `border-top:1px solid ${C.line};` : ""}">${esc(item.text)}</td>
<td align="right" style="padding:9px 0;white-space:nowrap;font:400 13px/1.4 ${FONT};${index ? `border-top:1px solid ${C.line};` : ""}">${link(item.href, item.action)}</td></tr>`).join("")}</table>`;
}

function sendLine(state: SendState, going: number, dayLabel: string, window: string) {
  if (state === "paused") return `Auto-send is paused, so nothing goes out ${dayLabel} until you resume it.`;
  if (state === "off") return going ? `Auto-send is off. ${plural(going, "email is", "emails are")} ready, but nothing goes out on its own.` : "Auto-send is off.";
  return going ? `<b>${plural(going, "email goes", "emails go")} out ${esc(dayLabel)}</b>, ${esc(window)} Eastern, a few minutes apart from your Gmail. No approval needed.` : `Nothing is queued for ${esc(dayLabel)}.`;
}

function shell(input: { preheader: string; kicker: string; title: string; intro: string; body: string; appHref: string; footer: string }) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.preheader)}</title></head><body style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(input.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:0 4px 18px">
<div style="font:700 11px/1.4 ${FONT};letter-spacing:.1em;text-transform:uppercase;color:${C.muted}">Night Watch · ${esc(input.kicker)}</div>
<div style="font:600 26px/1.2 ${FONT};color:${C.ink};letter-spacing:-.02em;margin:6px 0 6px">${esc(input.title)}</div>
<div style="font:400 15px/1.5 ${FONT};color:${C.ink}">${input.intro}</div>
</td></tr>
${input.body}
<tr><td align="center" style="padding:8px 0 4px">${button(input.appHref, "Open Night Watch")}</td></tr>
<tr><td align="center" style="padding:14px 4px 0;font:400 12px/1.5 ${FONT};color:${C.muted}">${esc(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const ADDRESS_NOTE: Record<ListCompany["address"], string> = { confirmed: "Address confirmed", unconfirmed: "Address not confirmed yet", missing: "Still finding an address" };

/** The morning email: today's send, the new list, yesterday's numbers, the last two weeks, insights and what needs you. */
export function morningEmail(data: MorningData): { subject: string; html: string; text: string } | null {
  const news = data.needs.length > 0 || data.meetings.length > 0 || data.yesterday.tiles.some((tile) => tile.label.startsWith("Repl") && tile.value > 0);
  if (!data.sendDay && !news) return null;
  const replies = data.yesterday.tiles.find((tile) => tile.label === "Replies")?.value ?? 0;
  const subject = data.send.state === "on" && data.send.going
    ? `${plural(data.send.going, "email goes", "emails go")} out today${data.list?.companies.length ? `, ${plural(data.list.companies.length, "new company", "new companies")} on your list` : ""}${replies ? `, ${plural(replies, "reply", "replies")} yesterday` : ""}`
    : data.list?.companies.length ? `${plural(data.list.companies.length, "new company", "new companies")} on your list today` : replies ? `${plural(replies, "reply", "replies")} came in yesterday` : "Your morning briefing";

  const parts: string[] = [];
  const queue = data.send.queue.slice(0, 6);
  parts.push(card("Today's send", `<div style="padding-bottom:${queue.length ? 10 : 0}px">${sendLine(data.send.state, data.send.going, data.send.dayLabel, data.send.window)}</div>${queue.length ? people(queue) : ""}${data.send.queue.length > queue.length ? `<div style="font:400 12px/1.4 ${FONT};color:${C.muted};padding-top:8px">and ${data.send.queue.length - queue.length} more</div>` : ""}`, { href: data.send.href, label: data.send.state === "on" ? "See the whole send order" : "Open Auto-send" }));
  if (data.list) {
    const shown = data.list.companies.slice(0, 12);
    const rows = shown.map((company) => ({ name: company.company, badge: company.company, company: company.sector, domain: company.domain, note: `${company.buyer ? `${company.buyer}${company.title ? `, ${company.title}` : ""} · ` : ""}${ADDRESS_NOTE[company.address]}`, tone: (company.address === "missing" ? "warn" : "plain") as Tone, href: company.href }));
    parts.push(card("New list", `${data.list.sectors.length > 1 ? `<div style="padding-bottom:12px">${bars(data.list.sectors.map((sector) => ({ ...sector, display: String(sector.value) })))}</div>` : ""}${people(rows)}`, { href: data.list.href, label: "Open the list" }, `${data.list.dateLabel} · ${plural(data.list.companies.length, "company", "companies")}`));
  }
  parts.push(card(data.yesterday.label, tiles(data.yesterday.tiles)));
  parts.push(card("Last 14 days", chart(data.chart), { href: data.yesterday.tiles[0]?.href ?? data.appHref, label: "See every email in Send history" }));
  if (data.insights.length) {
    parts.push(card("Insights", data.insights.map((insight, index) => `<div style="padding:${index ? "14px" : "0"} 0 0;${index ? `border-top:1px solid ${C.line};margin-top:14px;` : ""}">
<div style="font:600 14px/1.4 ${FONT};color:${C.ink}">${esc(insight.title)}</div>
<div style="font:400 13px/1.5 ${FONT};color:${C.muted};padding:2px 0 ${insight.bars ? 8 : 4}px">${esc(insight.text)}</div>
${insight.bars ? bars(insight.bars, C.accent) : ""}
<div style="padding-top:6px;font:400 13px/1.4 ${FONT}">${link(insight.href, "Look closer")}</div></div>`).join("")));
  }
  if (data.meetings.length) parts.push(card("Meetings ahead", needs(data.meetings.map((meeting) => ({ text: `${meeting.when}: ${meeting.name}${meeting.company ? `, ${meeting.company}` : ""}`, action: "Call brief", href: meeting.href })))));
  if (data.needs.length) parts.push(card("Needs you", needs(data.needs)));

  const intro = data.needs.length ? `${plural(data.needs.length, "thing needs", "things need")} you today. Everything else runs on its own.` : "Nothing needs you today. Everything runs on its own.";
  const text = [
    `Good morning, ${data.first}.`, data.dateLabel, "",
    `TODAY'S SEND: ${sendLine(data.send.state, data.send.going, data.send.dayLabel, data.send.window).replace(/<[^>]+>/g, "")}`,
    ...(data.list ? ["", `NEW LIST (${data.list.companies.length}):`, ...data.list.companies.map((company) => `- ${company.company} (${company.sector})${company.buyer ? `, ${company.buyer}` : ""}`), data.list.href] : []),
    "", `${data.yesterday.label.toUpperCase()}: ${data.yesterday.tiles.map((tile) => `${tile.label} ${tile.value}`).join(", ")}`,
    ...(data.insights.length ? ["", "INSIGHTS:", ...data.insights.map((insight) => `- ${insight.title}. ${insight.text}`)] : []),
    ...(data.needs.length ? ["", "NEEDS YOU:", ...data.needs.map((need) => `- ${need.text} ${need.href}`)] : []),
    "", `Night Watch: ${data.appHref}`,
  ].join("\n");
  return { subject, text, html: shell({ preheader: subject, kicker: data.dateLabel, title: `Good morning, ${data.first}.`, intro, body: parts.join("\n"), appHref: data.appHref, footer: "Sent each weekday morning before the send window. On weekends it only comes when there is news." }) };
}

/** The evening email: today's recap, tomorrow's send, what tonight's list build will look for, and anything to do before morning. */
export function eveningEmail(data: EveningData): { subject: string; html: string; text: string } {
  const sent = data.tiles.find((tile) => tile.label === "Emails sent")?.value ?? 0;
  const replies = data.tiles.find((tile) => tile.label === "Replies")?.value ?? 0;
  const subject = `Today: ${plural(sent, "email")} sent${replies ? `, ${plural(replies, "reply", "replies")}` : ""}. Tomorrow: ${data.tomorrow.state === "on" ? plural(data.tomorrow.going, "email") : "auto-send " + data.tomorrow.state}`;
  const parts: string[] = [];
  parts.push(card("Today's recap", tiles(data.tiles)));
  if (data.replies.length) parts.push(card("Who replied", people(data.replies), { href: data.repliesHref, label: "Answer replies" }));
  parts.push(card("Who you emailed", data.sent.length ? people(data.sent.slice(0, 10)) + (data.sent.length > 10 ? `<div style="font:400 12px/1.4 ${FONT};color:${C.muted};padding-top:8px">and ${data.sent.length - 10} more</div>` : "") : `<span style="color:${C.muted}">Nothing went out today.</span>`, { href: data.sentHref, label: "Open Send history" }));
  parts.push(card("Last 14 days", chart(data.chart)));
  const t = data.tomorrow;
  parts.push(card(`${t.dayLabel.charAt(0).toUpperCase()}${t.dayLabel.slice(1)}`, `<div>${sendLine(t.state, t.going, t.dayLabel, t.window)}</div>
${t.followups ? `<div style="padding-top:6px">${plural(t.followups, "follow-up")} also ${t.followups === 1 ? "goes" : "go"} out on ${t.followups === 1 ? "its" : "their"} own.</div>` : ""}
${t.state === "on" && t.unread ? `<div style="padding-top:6px;color:${C.muted}">You haven't read ${t.unread === t.going ? (t.going === 1 ? "it" : "any of them") : `${t.unread} of them`} yet. They go either way; read or hold any before 9:00 if you like.</div>` : ""}`, { href: t.href, label: "See the send order" }));
  const n = data.tonight;
  parts.push(card("Tonight's list build", n.building
    ? `<div>Around 10pm, Night Watch researches companies for <b>${esc(n.listDayLabel)}</b> and adds up to ${n.perSeat} to your list${n.listed ? ` (${n.listed} already there)` : ""}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px"><tr>
<td valign="top" width="50%" style="padding:10px 12px;background:${C.soft};border-radius:10px"><div style="font:400 12px/1.3 ${FONT};color:${C.muted}">Region it leads with</div><div style="font:600 14px/1.4 ${FONT};color:${C.ink};padding-top:3px">${esc(n.region)}</div></td>
<td width="8"></td>
<td valign="top" width="50%" style="padding:10px 12px;background:${C.soft};border-radius:10px"><div style="font:400 12px/1.3 ${FONT};color:${C.muted}">Sectors it starts with</div><div style="font:600 13px/1.4 ${FONT};color:${C.ink};padding-top:3px">${n.sectors.map((sector) => esc(sector.replace(/ such as .*$/, ""))).join("<br>")}</div></td>
</tr></table>
<div style="font:400 12px/1.5 ${FONT};color:${C.muted};padding-top:10px">${esc(n.note)}</div>`
    : `<div>${esc(n.note)}</div>`));
  if (data.needs.length) parts.push(card("Before tomorrow", needs(data.needs)));
  const text = [
    `Evening recap, ${data.first}.`, data.dateLabel, "",
    `TODAY: ${data.tiles.map((tile) => `${tile.label} ${tile.value}`).join(", ")}`,
    ...(data.replies.length ? ["", "REPLIES:", ...data.replies.map((row) => `- ${row.name}, ${row.company}: ${row.note}`)] : []),
    "", `${t.dayLabel.toUpperCase()}: ${sendLine(t.state, t.going, t.dayLabel, t.window).replace(/<[^>]+>/g, "")}`,
    "", `TONIGHT: ${n.building ? `list build for ${n.listDayLabel}, leading with ${n.region}: ${n.sectors.join("; ")}.` : n.note}`,
    ...(data.needs.length ? ["", "BEFORE TOMORROW:", ...data.needs.map((need) => `- ${need.text} ${need.href}`)] : []),
    "", `Night Watch: ${data.appHref}`,
  ].join("\n");
  const intro = sent || replies ? `${plural(sent, "email")} went out today${replies ? ` and ${plural(replies, "person", "people")} replied` : ""}. Here's the day, and what happens overnight.` : "A quiet day. Here's what happens overnight and tomorrow.";
  return { subject, text, html: shell({ preheader: subject, kicker: data.dateLabel, title: `Evening recap, ${data.first}.`, intro, body: parts.join("\n"), appHref: data.appHref, footer: "Sent each weekday evening." }) };
}
