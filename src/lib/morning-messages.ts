/**
 * Slack messages for the nightly list and the morning auto-send: Block Kit blocks plus a plain-text fallback.
 * Pure and free of app imports so a plain node test can drive them.
 */
import { rowForecast } from "./morning-send-rules.ts";

export type SlackBlock = Record<string, unknown>;
export type SlackMessage = { text: string; blocks: SlackBlock[] };
export type ListStatus = "missing" | "building" | "failed";

/** Slack allows 50 blocks per message and 3,000 characters in a section's text. */
export const SLACK_MAX_BLOCKS = 50;
export const SLACK_MAX_SECTION = 3000;
const SECTION_BUDGET = 2900;

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
/** Slack mrkdwn treats &, < and > as control characters. */
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…` : value);
const link = (url: string, label: string) => `<${url}|${escape(label).replace(/\|/g, "/")}>`;
const section = (text: string): SlackBlock => ({ type: "section", text: { type: "mrkdwn", text: clip(text, SECTION_BUDGET) } });
const context = (text: string): SlackBlock => ({ type: "context", elements: [{ type: "mrkdwn", text: clip(text, SECTION_BUDGET) }] });
const seatName = (owner: string) => (owner === "josh" ? "Josh" : owner === "jenna" || owner === "suuchi" ? "Suuchi" : owner);
const listKey = (owner: string) => (owner === "josh" ? "josh" : "suuchi");

/** Pack lines into as few sections as fit Slack's limits, leaving `reserve` blocks for the rest of the message. */
function packLines(lines: string[], reserve: number): SlackBlock[] {
  const blocks: SlackBlock[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > SECTION_BUDGET && current) { blocks.push(section(current)); current = line; } else current = next;
  }
  if (current) blocks.push(section(current));
  const room = SLACK_MAX_BLOCKS - reserve;
  if (blocks.length <= room) return blocks;
  return [...blocks.slice(0, room - 1), section(`…and more. Open the desk for the full list.`)];
}

type RowFacts = { company: string; domain: string; rank: number | null; fit: number | null; why: string; sector: string };
function facts(row: unknown, index: number): RowFacts {
  const value = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const fit = (value.aiFit && typeof value.aiFit === "object" ? value.aiFit : {}) as { score?: unknown; summary?: unknown; reasons?: unknown; disqualified?: unknown };
  const reasons = Array.isArray(fit.reasons) ? fit.reasons as Array<{ text?: unknown }> : [];
  const why = typeof fit.summary === "string" && fit.summary.trim() ? fit.summary : typeof reasons[0]?.text === "string" ? String(reasons[0].text) : "";
  return {
    company: typeof value.company === "string" && value.company.trim() ? value.company.trim() : typeof value.domain === "string" ? value.domain : "Unknown company",
    domain: typeof value.domain === "string" ? value.domain : "",
    rank: typeof value.rank === "number" && value.rank > 0 ? value.rank : index + 1,
    fit: typeof fit.score === "number" && Number.isFinite(fit.score) && !fit.disqualified ? fit.score : null,
    why: clip(why.replace(/\s+/g, " ").trim(), 140),
    sector: typeof value.sector === "string" ? clip(value.sector.trim(), 60) : "",
  };
}

export type AnnounceWindow = { owner: string; baseUrl: string; sendFrom: number; sendUntil: number; size?: number };

/** The 7:00 message for a ready list: what will auto-send and what needs a person, one line per company in list order. */
export function announceBlocks(rows: unknown[], cardIdsByDomain: Record<string, string>, blocker: string | null, window: AnnounceWindow): SlackMessage {
  const seat = seatName(window.owner);
  const deskUrl = `${window.baseUrl}/outreach?list=${listKey(window.owner)}&batch=today`;
  const forecasts = rows.map((row) => rowForecast(row));
  const sending = blocker ? 0 : forecasts.filter((forecast) => forecast.send).length;
  const from = clock(window.sendFrom), until = clock(window.sendUntil);
  const short = window.size && rows.length < window.size ? ` The list is short: ${rows.length} of ${window.size}.` : "";
  const header = blocker
    ? `${rows.length} companies are ready for ${seat} today. Nothing sends automatically: ${blocker}.${short}`
    : `${sending} expected to auto-send ${from} to ${until}, ${rows.length - sending} need you (${seat}'s list).${short}`;
  const lines = rows.map((row, index) => {
    const item = facts(row, index);
    const forecast = forecasts[index];
    const cardId = cardIdsByDomain[item.domain];
    const name = cardId ? link(`${deskUrl}&card=${encodeURIComponent(cardId)}`, item.company) : escape(item.company);
    const state = blocker ? "send by hand" : forecast.send ? "expected to send" : `held: ${forecast.reason ?? "address not confirmed"}`;
    const detail = [item.fit !== null ? `fit ${item.fit}` : "", item.why, item.sector].filter(Boolean).map(escape).join(" · ");
    return clip(`${item.rank}. *${name}*${detail ? ` · ${detail}` : ""} · _${escape(state)}_`, 600);
  });
  const footer = blocker ? `Review and send: ${deskUrl}` : `Keep or edit any before ${from}: ${deskUrl}`;
  const blocks = [section(escape(header)), ...packLines(lines, 2), context(link(deskUrl, footer))];
  const text = [header, ...rows.map((row, index) => {
    const item = facts(row, index);
    const forecast = forecasts[index];
    return `${item.rank}. ${item.company}${item.fit !== null ? ` (fit ${item.fit})` : ""}: ${blocker ? "send by hand" : forecast.send ? "expected to send" : `held, ${forecast.reason ?? "address not confirmed"}`}`;
  }), footer].join("\n");
  return { text: clip(text, 3900), blocks };
}

export type HeldCard = { company: string; reason: string };

/** The message after the window closes: what went, each card left unsent with its reason, and what was kept by hand. */
export function summaryBlocks(sent: number, held: HeldCard[], keptByYou: number, options: { owner: string; baseUrl: string }): SlackMessage {
  const seat = seatName(options.owner);
  const deskUrl = `${options.baseUrl}/outreach?list=${listKey(options.owner)}&batch=today`;
  const parts = [`${seat}'s morning send is done: ${sent} sent automatically`];
  if (keptByYou) parts.push(`${keptByYou} kept by you to send by hand`);
  if (held.length) parts.push(`${held.length} left on the list to review and send by hand`);
  const header = `${parts.join(", ")}.`;
  const lines = held.map((card) => clip(`• *${escape(card.company)}*: ${escape(card.reason)}`, 500));
  const blocks = [section(escape(header)), ...packLines(lines, 2), context(link(deskUrl, "Open today's list"))];
  const text = [header, ...held.map((card) => `- ${card.company}: ${card.reason}`), deskUrl].join("\n");
  return { text: clip(text, 3900), blocks };
}

/** The 7:00 alert when there is no usable list: missing, still building, or failed, with the top reasons. */
export function listProblemAlert(owner: string, status: ListStatus, rows: number, size: number, topReasons: string[], options: { baseUrl: string }): SlackMessage {
  const seat = seatName(owner);
  const deskUrl = `${options.baseUrl}/outreach?list=${listKey(owner)}&batch=today`;
  const why = status === "missing" ? "the nightly build never started" : status === "building" ? "the nightly build did not finish" : "the nightly build failed";
  const reasons = topReasons.filter(Boolean).slice(0, 3).map((reason) => clip(reason, 300));
  const header = `No list for ${seat} today: ${why} (${rows} of ${size} companies). Nothing sends automatically.`;
  const blocks = [section(`:warning: ${escape(header)}`)];
  if (reasons.length) blocks.push(section(`Top reasons:\n${reasons.map((reason) => `• ${escape(reason)}`).join("\n")}`));
  blocks.push(context(link(deskUrl, "Open the desk")));
  const text = `${header}${reasons.length ? ` Top reasons: ${reasons.join("; ")}.` : ""} Desk: ${deskUrl}`;
  return { text, blocks };
}

/** The message when the bounce brake pauses a seat: why, which addresses bounced, what is left, and where to fix it. */
export function bouncePauseText(owner: string, reason: string, bounced: Array<{ email: string; company?: string }>, unsent: number, links: { list: string; settings: string }) {
  const shown = bounced.slice(0, 5).map((item) => `${item.email}${item.company ? ` (${item.company})` : ""}`);
  const more = bounced.length > shown.length ? ` and ${bounced.length - shown.length} more` : "";
  return [
    `Auto-send paused for ${seatName(owner)}: ${reason}`,
    shown.length ? `Bounced: ${shown.join(", ")}${more}.` : "",
    `${unsent} of today's list still unsent: ${links.list}`,
    `Fix the addresses, then resume in Settings: ${links.settings}`,
  ].filter(Boolean).join("\n");
}

/** The alert when a nightly or morning cron run throws. */
export function buildFailureText(error: unknown, job = "The nightly list build") {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  return `${job} failed: ${clip(message.replace(/\s+/g, " ").trim() || "unknown error", 500)}. Nothing sends automatically until it is fixed or a list is ready.`;
}

/**
 * Whether the 8:00 card digest should still go to a seat. A seat with a ready list for today already had the
 * 7:00 list message, and the digest's count (cards surfaced today) would contradict it, so it gets one message.
 */
export function shouldSendMorningDigest(_seat: string, todaysListStatus: string | null | undefined) {
  return todaysListStatus !== "ready";
}

/** The once-a-day warning that part of the morning falls outside the cron's hours. */
export function windowWarningText(problems: string[]) {
  if (!problems.length) return null;
  return `Check the morning send times: ${problems.join("; ")}. Change SEND_TIMEZONE, LIST_ANNOUNCE_AT, AUTO_SEND_FROM or AUTO_SEND_UNTIL, or the morning-send hours in vercel.json.`;
}
