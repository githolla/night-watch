import { loadAutoSendView, type AutoSendEmail } from "./autosend-view.ts";
import { bulkSendable, sendableAddress } from "./bulk-sendable.ts";
import type { EveningData, ListCompany, MorningData, Need, PersonRow, SendState, Tile } from "./daily-email.ts";
import type { HomeData, HomeTodayRow } from "./home-view.ts";
import { addLogos } from "./email-logos.ts";
import { personHref } from "./home-today.ts";
import { loadHome } from "./home-view.ts";
import { industryOf } from "./send-plan.ts";
import { nightFocus } from "./list-sectors.ts";
import { localParts } from "./local-time.ts";
import { isSendDay } from "./morning-send-rules.ts";
import { sendDayStart } from "./send-guards.ts";
import { learnedSectorWeights, nightlyListConfig } from "./nightly-list-builder.ts";
import { chartDays, insightsFrom, nextSendDay, previousSendDay } from "./daily-email-stats.ts";
import { shiftDate } from "./sent-stats.ts";
import { loadSentTouches } from "./sent-view.ts";
import { admin } from "./supabase/admin.ts";
import type { Owner } from "./types.ts";

const ZONE = process.env.SEND_TIMEZONE ?? "America/New_York";
const REAL_REPLY = new Set(["positive", "referral", "neutral", "objection", "negative"]);
const POSITIVE = new Set(["positive", "referral"]);
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ZONE });
const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** A list row's sector, short: "specialty construction trades such as HVAC..." reads "Specialty construction trades". */
const sectorLabel = (sector: string | undefined) => {
  const short = (sector ?? "").replace(/ such as .*$/, "").trim();
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : "";
};

type Db = ReturnType<typeof admin>;
type Seat = { owner: Owner; base: string; now: Date };
const q = (owner: Owner) => `owner=${owner}`;

function sendState(home: HomeData): SendState {
  if (home.autoSend?.control.paused) return "paused";
  return home.autoSend && !home.autoSend.plan.blocker ? "on" : "off";
}

const asRow = (base: string) => (row: HomeTodayRow): PersonRow => ({ name: row.name, company: row.company, domain: row.domain, note: row.note, tone: row.tone, href: row.href ? `${base}${row.href}` : `${base}/`, time: row.at ? clock(row.at) : row.time ?? undefined });

function needsFrom(home: HomeData, { owner, base }: Seat): Need[] {
  const out: Need[] = [];
  if (home.replies.length) out.push({ text: home.replies.length === 1 ? `${home.replies[0].name}${home.replies[0].company ? ` at ${home.replies[0].company}` : ""} is waiting for an answer.` : `${home.replies.length} replies are waiting for an answer.`, action: "Answer", href: `${base}/replies?${q(owner)}` });
  if (home.bounces.length) out.push({ text: home.bounces.length === 1 ? `${home.bounces[0].name}'s address bounced. Give it a new one and the email goes back in the queue.` : `${home.bounces.length} addresses bounced. Fix them and the emails go back in the queue.`, action: "Fix", href: `${base}/?${q(owner)}` });
  if (home.followupsDue) out.push({ text: `${home.followupsDue === 1 ? "A follow-up" : `${home.followupsDue} follow-ups`} couldn't go out on ${home.followupsDue === 1 ? "its" : "their"} own.`, action: "Send", href: `${base}/followups?view=needs&${q(owner)}` });
  if (home.linkedin) out.push({ text: `${home.linkedin === 1 ? "A LinkedIn message is" : `${home.linkedin} LinkedIn messages are`} ready to send by hand.`, action: "Send", href: `${base}/linkedin?${q(owner)}` });
  return out;
}

const queueRows = (emails: AutoSendEmail[], base: string, owner: Owner, listed: ReadonlySet<string>): PersonRow[] => emails.filter((email) => email.group === "going").map((email) => ({
  name: email.name, company: email.company, domain: email.domain, note: email.subject || "No subject", tone: "plain", href: `${base}${personHref(owner, listed, email.id, email.domain)}`, time: email.time ?? undefined,
}));

/** Today's list for the seat, each company with its buyer and whether the address is confirmed. */
async function todaysList(db: Db, { owner, base }: Seat, date: string): Promise<MorningData["list"]> {
  const { data: list } = await db.from("reachout_lists").select("status,rows").eq("owner", owner).eq("list_date", date).maybeSingle();
  const rows = ((list?.status === "ready" ? list.rows : null) ?? []) as Array<{ domain: string; company?: string; sector?: string }>;
  if (!rows.length) return null;
  const { data: cards } = await db.from("cards").select("id,status,accounts!inner(domain),people(full_name,title,email,email_status,email_check)").eq("assigned_to", owner).in("accounts.domain", rows.map((row) => row.domain));
  type CardRow = { id: string; accounts: { domain: string }; people: { full_name: string | null; title: string | null; email: string | null; email_status: string | null; email_check: unknown } | null };
  const byDomain = new Map(((cards ?? []) as unknown as CardRow[]).map((card) => [card.accounts.domain.toLowerCase(), card]));
  const companies: ListCompany[] = rows.map((row) => {
    const card = byDomain.get(row.domain.toLowerCase());
    const person = card?.people;
    return {
      company: row.company ?? row.domain, domain: row.domain, sector: sectorLabel(row.sector) || industryOf(row.sector, row.company), buyer: person?.full_name ?? "", title: person?.title ?? "",
      address: person && sendableAddress(person) ? (bulkSendable(person) ? "confirmed" : "unconfirmed") : "missing",
      href: card ? `${base}/outreach?list=${owner}&batch=today&card=${card.id}` : `${base}/outreach?list=${owner}&batch=today`,
    };
  });
  const counts = new Map<string, number>();
  for (const company of companies) counts.set(company.sector, (counts.get(company.sector) ?? 0) + 1);
  return { dateLabel: longDate(date), companies, sectors: [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value), href: `${base}/outreach?list=${owner}&batch=today` };
}

async function meetingsAhead(db: Db, { owner, base, now }: Seat): Promise<MorningData["meetings"]> {
  const { data } = await db.from("cards").select("id,meeting_at,people(full_name),accounts(name)").eq("assigned_to", owner).gte("meeting_at", now.toISOString()).lte("meeting_at", new Date(now.getTime() + 7 * 86_400_000).toISOString()).order("meeting_at").limit(5);
  type Row = { id: string; meeting_at: string; people: { full_name: string | null } | null; accounts: { name: string | null } | null };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    name: row.people?.full_name ?? "A prospect", company: row.accounts?.name ?? "", href: `${base}/brief/${row.id}`,
    when: new Date(row.meeting_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: ZONE }),
  }));
}

export async function loadMorningEmail(owner: Owner, base: string, now: Date = new Date()): Promise<MorningData> {
  const db = admin();
  const seat = { owner, base, now };
  const local = localParts(now);
  const [home, view, sent, list, meetings] = await Promise.all([
    loadHome(owner, now), loadAutoSendView(owner).catch(() => null), loadSentTouches(owner, 60, now).catch(() => null),
    todaysList(db, seat, local.date).catch(() => null), meetingsAhead(db, seat).catch(() => []),
  ]);
  const touches = sent?.touches ?? [];
  const dayOf = sent?.dayOf ?? ((iso: string) => localParts(new Date(iso)).date);
  const last = previousSendDay(local.date);
  const lastLabel = last === shiftDate(local.date, -1) ? "Yesterday" : dayName(last);
  const onDay = touches.filter((touch) => dayOf(touch.sentAt) === last);
  const repliedThen = touches.filter((touch) => touch.replyAt && dayOf(touch.replyAt) === last && REAL_REPLY.has(touch.replyClass ?? ""));
  const firstIds = new Set<string>();
  const seenCard = new Set<string>();
  for (const touch of [...touches].sort((a, b) => a.sentAt.localeCompare(b.sentAt))) if (!seenCard.has(touch.cardId)) { seenCard.add(touch.cardId); firstIds.add(touch.id); }
  const weekSends = touches.filter((touch) => { const day = dayOf(touch.sentAt); return day > shiftDate(last, -7) && day <= last; });
  const sendDays = new Set(weekSends.map((touch) => dayOf(touch.sentAt))).size || 1;
  const sentHref = `${base}/drafts/sent?${q(owner)}&days=7`;
  const firsts = onDay.filter((touch) => firstIds.has(touch.id)).length;
  const bounced = onDay.filter((touch) => touch.bouncedAt).length;
  const interested = repliedThen.filter((touch) => POSITIVE.has(touch.replyClass ?? "")).length;
  const tiles: Tile[] = [
    { label: "Emails sent", value: onDay.length, note: onDay.length ? `${firsts} first, ${onDay.length - firsts} follow-up · avg ${Math.round(weekSends.length / sendDays)}/day` : "None went out", tone: "plain", href: sentHref },
    { label: "Replies", value: repliedThen.length, note: repliedThen.length ? "Out-of-office not counted" : "None that day", tone: "good", href: `${base}/replies?${q(owner)}` },
    { label: "Interested", value: interested, note: interested ? "Said yes or pointed you on" : "Not yet", tone: "good", href: `${base}/replies?${q(owner)}` },
    { label: "Bounces", value: bounced, note: bounced ? "Fix on Overview" : "All delivered", tone: "warn", href: `${base}/?${q(owner)}` },
  ];
  const state = sendState(home);
  const queue = state === "on" ? queueRows(view?.emails ?? [], base, owner, new Set(home.listed)) : [];
  await addLogos([...queue.slice(0, 6), ...(list?.companies.slice(0, 12) ?? [])]);
  return {
    first: home.first, dateLabel: longDate(local.date), appHref: `${base}/?${q(owner)}`,
    send: { state, going: home.autoSend?.plan.going ?? 0, window: home.autoSend?.plan.windowLabel ?? "", dayLabel: home.autoSend?.plan.dayLabel ?? "today", queue, href: `${base}/auto-send?${q(owner)}` },
    list, yesterday: { label: lastLabel, tiles }, chart: chartDays(touches, local.date, dayOf),
    insights: insightsFrom(touches, local.date, dayOf, { sent: sentHref, results: `${base}/stats` }),
    needs: needsFrom(home, seat), meetings, sendDay: isSendDay(local.weekday, local.date),
  };
}

export async function loadEveningEmail(owner: Owner, base: string, now: Date = new Date()): Promise<EveningData> {
  const db = admin();
  const seat = { owner, base, now };
  const local = localParts(now);
  const tomorrow = nextSendDay(local.date);
  // The nightly routine runs Sunday to Thursday nights and builds the next weekday's list.
  const building = ["Sun", "Mon", "Tue", "Wed", "Thu"].includes(local.weekday) && tomorrow === shiftDate(local.date, 1);
  const [home, sent, followups, weights, existing] = await Promise.all([
    loadHome(owner, now), loadSentTouches(owner, 30, now).catch(() => null),
    db.from("cadence_steps").select("id,cadences!inner(owner)", { count: "exact", head: true }).eq("cadences.owner", owner).eq("channel", "email").in("status", ["pending", "ready"])
      .gte("scheduled_at", sendDayStart(new Date(`${tomorrow}T16:00:00Z`)).toISOString()).lt("scheduled_at", sendDayStart(new Date(`${shiftDate(tomorrow, 1)}T16:00:00Z`)).toISOString()).then((r) => r.count ?? 0),
    learnedSectorWeights(db).catch(() => ({} as Record<string, number>)),
    db.from("reachout_lists").select("rows").eq("owner", owner).eq("list_date", tomorrow).maybeSingle().then((r) => (Array.isArray(r.data?.rows) ? r.data.rows.length : 0)),
  ]);
  const rows = home.today.rows;
  const firsts = rows.sent.filter((row) => !row.followup).length;
  const touches = sent?.touches ?? [];
  const dayOf = sent?.dayOf ?? ((iso: string) => localParts(new Date(iso)).date);
  const focus = nightFocus(tomorrow, weights);
  const perSeat = nightlyListConfig().size;
  const tiles: Tile[] = [
    { label: "Emails sent", value: rows.sent.length, note: rows.sent.length ? `${firsts} first, ${rows.sent.length - firsts} follow-up` : "None today", tone: "plain", href: `${base}/drafts/sent?${q(owner)}&days=1` },
    { label: "Replies", value: rows.replies.length, note: home.today.interested ? `${home.today.interested} interested` : "Out-of-office not counted", tone: "good", href: `${base}/replies?${q(owner)}` },
    { label: "LinkedIn", value: rows.linkedin.length, note: home.linkedin ? `${home.linkedin} ready` : "Nothing waiting", tone: "plain", href: `${base}/linkedin?${q(owner)}` },
    { label: "Bounces", value: rows.bounces.length, note: rows.bounces.some((row) => row.fix) ? "Fix on Overview" : rows.bounces.length ? "All fixed" : "All delivered", tone: "warn", href: `${base}/?${q(owner)}` },
  ];
  const state = sendState(home);
  const unread = home.drafts.nextUnapproved;
  const sentRows = rows.sent.map(asRow(base)), replyRows = rows.replies.map(asRow(base));
  await addLogos([...sentRows.slice(0, 10), ...replyRows]);
  return {
    first: home.first, dateLabel: longDate(local.date), appHref: `${base}/?${q(owner)}`, tiles,
    sent: sentRows, sentHref: `${base}/drafts/sent?${q(owner)}&days=1`,
    replies: replyRows, repliesHref: `${base}/replies?${q(owner)}`,
    chart: chartDays(touches, local.date, dayOf),
    tomorrow: { state, going: home.autoSend?.plan.going ?? 0, window: home.autoSend?.plan.windowLabel ?? "", dayLabel: home.autoSend?.plan.dayLabel ?? (tomorrow === shiftDate(local.date, 1) ? "tomorrow" : dayName(tomorrow)), followups, unread, href: `${base}/auto-send?${q(owner)}` },
    tonight: {
      building, listDayLabel: dayName(tomorrow), region: focus.region, sectors: focus.sectors, perSeat, listed: existing,
      note: building
        ? "It keeps only companies whose size, buyer and evidence the app can confirm, so some nights add fewer. New companies go out the next morning."
        : `No list build tonight. The next one runs Sunday night for ${dayName(tomorrow)}.`,
    },
    needs: needsFrom(home, seat),
  };
}
