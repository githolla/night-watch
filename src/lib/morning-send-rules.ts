/** Pure rules for the morning auto-send, kept free of app imports so they can be tested directly. */
import { localParts } from "./local-time.ts";

const hhmm = (name: string, fallback: number) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(process.env[name]?.trim() ?? "");
  return match ? Math.min(23 * 60 + 59, Number(match[1]) * 60 + Number(match[2])) : fallback;
};

/** Local times (minutes after midnight in SEND_TIMEZONE), pacing and the bounce brake. Times are HH:MM env overrides. */
export const MORNING = {
  announceAt: hhmm("LIST_ANNOUNCE_AT", 7 * 60),
  sendFrom: hhmm("AUTO_SEND_FROM", 9 * 60),
  sendUntil: hhmm("AUTO_SEND_UNTIL", 11 * 60 + 30),
  runEveryMinutes: 10,
  /** At most this many automatic sends per seat per run, so a late start never bursts the list. */
  maxPerRun: 2,
  /** Random wait before each automatic send, so mail does not leave on the exact cron tick. */
  maxJitterMs: 45_000,
  /** Stop starting sends once the invocation is this old; the route's maxDuration is 300 s. */
  runBudgetMs: 240_000,
  bounceRate: 0.05, bounceMinSends: 10, bounceWindowDays: 7, recentBounceHours: 48, recentBounceLimit: 2,
};

/** The cron that drives the morning run: every ten minutes from 10:00 to 17:50 UTC (vercel.json). */
export const MORNING_CRON_UTC = { first: 10 * 60, last: 17 * 60 + 50 };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Lists build and auto-send only on SEND_DAYS (default Mon to Fri), never on a SKIP_DATES date (YYYY-MM-DD). */
export function isSendDay(weekday: string, date?: string) {
  const configured = (process.env.SEND_DAYS ?? "Mon,Tue,Wed,Thu,Fri").split(",").map((day) => day.trim().slice(0, 3).toLowerCase()).filter(Boolean);
  const days = configured.filter((day) => DAY_NAMES.some((name) => name.toLowerCase() === day));
  if (!days.includes(weekday.trim().slice(0, 3).toLowerCase())) return false;
  if (!date) return true;
  const skip = (process.env.SKIP_DATES ?? "").split(",").map((value) => value.trim()).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  return !skip.includes(date);
}

/** How many to send this run so the rest spread evenly over the remaining window, never more than maxPerRun. */
export function paceForRun(remaining: number, minutesNow: number, sendUntil = MORNING.sendUntil, every = MORNING.runEveryMinutes, maxPerRun = MORNING.maxPerRun) {
  if (remaining <= 0 || minutesNow >= sendUntil) return 0;
  const runsLeft = Math.max(1, Math.ceil((sendUntil - minutesNow) / every));
  return Math.min(maxPerRun, Math.ceil(remaining / runsLeft));
}

/**
 * Pause on 2 or more bounces in the last 48 hours, or when more than 5% of first emails bounced once there
 * are at least 10 of them. Counts cover the last 7 days, or since the seat was last resumed if that is later.
 */
export function bounceBrake(sent: number, bounced: number, bouncedRecently = 0) {
  if (bouncedRecently >= MORNING.recentBounceLimit) return true;
  return sent >= MORNING.bounceMinSends && bounced / sent > MORNING.bounceRate;
}

/** The words for why the brake fired, saved as the pause reason. */
export function bounceReason(sent: number, bounced: number, bouncedRecently: number) {
  const why = bouncedRecently >= MORNING.recentBounceLimit
    ? `${bouncedRecently} first emails bounced in the last ${MORNING.recentBounceHours} hours`
    : `${bounced} of ${sent} first emails bounced in the last ${MORNING.bounceWindowDays} days (over ${Math.round(MORNING.bounceRate * 100)}%)`;
  return `${why}. Auto-send and automatic follow-ups are paused.`;
}

type SeatState = { autoSend: boolean; paused: boolean; postalAddress: string; skipOn?: string | null; today?: string };

/** Why auto-send will not run for this seat, or null when it will. */
export function autoSendBlocker(seatState: SeatState) {
  if (!seatState.autoSend) return "auto-send is off";
  if (seatState.paused) return "auto-send is paused";
  if (!seatState.postalAddress) return "no postal address is set for the email footer";
  if (seatState.skipOn && seatState.today && seatState.skipOn === seatState.today) return "auto-send is skipped for today";
  return null;
}

/**
 * Why an automatic follow-up must wait for a person, or null when it may send. Deliberately not
 * autoSendBlocker: a seat with morning auto-send off still sends its follow-ups.
 */
export function followupHoldReason(seatState: { paused: boolean; pausedReason?: string | null; postalAddress: string }) {
  if (seatState.paused) return `Automatic follow-ups are paused for this seat${seatState.pausedReason ? ` (${seatState.pausedReason.replace(/\.\s*$/, "")})` : ""}. Send by hand or resume in Settings.`;
  if (!seatState.postalAddress.trim()) return "Add a postal address in Settings before automatic follow-ups send.";
  return null;
}

/** Why a list row must not auto-send because its buyer is not confirmed, from the row's identityHold field. */
export function identityHoldReason(row: unknown): string | null {
  const hold = row && typeof row === "object" && "identityHold" in row ? (row as { identityHold: unknown }).identityHold : null;
  if (typeof hold === "string") return hold.trim() || null;
  if (hold === true) return "the buyer's identity is not confirmed";
  if (hold && typeof hold === "object" && "reason" in hold && typeof (hold as { reason: unknown }).reason === "string") return (hold as { reason: string }).reason;
  return null;
}

/** What the morning run expects for a row: send, or held with the reason. */
export function rowForecast(row: unknown): { send: boolean; reason: string | null } {
  const identity = identityHoldReason(row);
  if (identity) return { send: false, reason: identity };
  const check = row && typeof row === "object" && "emailCheck" in row ? (row as { emailCheck: unknown }).emailCheck : null;
  const level = check && typeof check === "object" && "level" in check ? (check as { level: unknown }).level : null;
  if (level === "deliverable") return { send: true, reason: null };
  const reason = check && typeof check === "object" && "reason" in check && typeof (check as { reason: unknown }).reason === "string" ? (check as { reason: string }).reason : "";
  return { send: false, reason: reason || "address not confirmed" };
}

const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
const utcClock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} UTC`;

/** Minutes the zone is ahead of UTC on this date. */
function zoneOffset(timeZone: string, date: Date) {
  const noon = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12));
  const local = localParts(noon, timeZone);
  const dayShift = local.date === noon.toISOString().slice(0, 10) ? 0 : local.date > noon.toISOString().slice(0, 10) ? 1440 : -1440;
  return local.minutes + dayShift - 12 * 60;
}

/**
 * Parts of the morning that the cron never reaches on this date: the announcement, the sends and one tick
 * after the window for the summary must all fall inside 10:00 to 17:50 UTC.
 */
export function morningWindowProblems(timeZone: string, announceAt: number, sendFrom: number, sendUntil: number, date: Date) {
  const offset = zoneOffset(timeZone, date);
  const utc = (minutes: number) => minutes - offset;
  const problems: string[] = [];
  const announce = utc(announceAt), from = utc(sendFrom), until = utc(sendUntil);
  if (announce < MORNING_CRON_UTC.first || announce > MORNING_CRON_UTC.last) problems.push(`the ${clock(announceAt)} announcement falls at ${utcClock((announce + 1440) % 1440)}, outside the morning cron (10:00 to 17:50 UTC)`);
  if (from < MORNING_CRON_UTC.first) problems.push(`sending is set to start at ${clock(sendFrom)} (${utcClock((from + 1440) % 1440)}), before the first morning cron run at 10:00 UTC`);
  if (until > MORNING_CRON_UTC.last) problems.push(`sending is set to run until ${clock(sendUntil)} (${utcClock((until + 1440) % 1440)}), after the last morning cron run at 17:50 UTC, so the window is cut short and the summary is never posted`);
  return problems;
}

export type ForecastRow = { company: string; send: boolean; reason: string | null };

/** The 7:00 message for a ready list. */
export function announceText(input: { seat: string; rows: ForecastRow[]; blocker: string | null; size: number; link: string; sendFrom?: number; sendUntil?: number }) {
  const from = clock(input.sendFrom ?? MORNING.sendFrom), until = clock(input.sendUntil ?? MORNING.sendUntil);
  const short = input.rows.length < input.size ? ` The list is short: ${input.rows.length} of ${input.size}.` : "";
  if (input.blocker) return `${input.rows.length} companies are ready for ${input.seat} today. Nothing sends automatically (${input.blocker}).${short} Review and send: ${input.link}`;
  const sending = input.rows.filter((row) => row.send).length;
  const lines = input.rows.map((row, index) => `${index + 1}. ${row.company}: ${row.send ? "expected to send" : `held, ${row.reason ?? "address not confirmed"}`}`);
  return [`${sending} of ${input.rows.length} companies for ${input.seat} are expected to auto-send ${from} to ${until}; ${input.rows.length - sending} need you.${short} Remove or edit any before ${from}: ${input.link}`, ...lines].join("\n");
}

/** The 7:00 alert when there is no usable list. */
export function listAlertText(input: { seat: string; status: "missing" | "building" | "failed"; rows: number; size: number; errors?: string[]; link: string }) {
  const why = input.status === "missing" ? "the nightly build never started" : input.status === "building" ? "the nightly build did not finish" : "the nightly build failed";
  const errors = (input.errors ?? []).filter(Boolean).slice(0, 3);
  return `No list for ${input.seat} today: ${why} (${input.rows} of ${input.size} companies).${errors.length ? ` Top reasons: ${errors.join("; ")}.` : ""} Nothing sends automatically. Desk: ${input.link}`;
}

export type HeldCard = { company: string; reason: string };

/** The message after the window closes, naming every card left unsent and why. */
export function summaryText(input: { seat: string; sent: number; held: HeldCard[]; kept: number; link: string }) {
  const parts = [`${input.seat}'s morning send is done: ${input.sent} sent automatically`];
  if (input.kept) parts.push(`${input.kept} kept by you to send by hand`);
  if (input.held.length) parts.push(`${input.held.length} left on the list to review and send by hand`);
  const lines = input.held.map((card) => `- ${card.company}: ${card.reason}`);
  return [`${parts.join(", ")}. ${input.link}`, ...lines].join("\n");
}

/** The message when the bounce brake pauses a seat. */
export function pauseText(input: { seat: string; reason: string; bounced: Array<{ email: string; company: string }>; unsent: number; listLink: string; settingsLink: string }) {
  const shown = input.bounced.slice(0, 5).map((item) => `${item.email}${item.company ? ` (${item.company})` : ""}`);
  return [
    `Auto-send paused for ${input.seat}: ${input.reason}`,
    shown.length ? `Bounced: ${shown.join(", ")}.` : "",
    `${input.unsent} of today's list still unsent: ${input.listLink}`,
    `Fix the addresses, then resume in Settings: ${input.settingsLink}`,
  ].filter(Boolean).join("\n");
}

/** Every http(s) link the recipient can see or click, across the text part and the HTML hrefs, de-duplicated. */
export function deliveredLinks(text: string, html: string) {
  const strip = (url: string) => url.replace(/[).,;:!?'"]+$/, "").replace(/&amp;/g, "&");
  const found = [...text.matchAll(/https?:\/\/[^\s<>"']+/gi), ...html.matchAll(/href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)].map((match) => strip(match[1] ?? match[0]));
  return [...new Set(found)];
}

/** Why the final automatic email breaks the plain-text guardrail (images or more than one link), or null. */
export function automaticContentProblem(text: string, html: string) {
  if (/<img\b|cid:|data:image/i.test(html)) return "The email would carry an image. Auto-sent mail must be plain text; send it by hand.";
  const links = deliveredLinks(text, html);
  if (links.length > 1) return `The email would carry ${links.length} links; auto-sent mail allows at most one. Send it by hand.`;
  return null;
}
