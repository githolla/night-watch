import { cronAuthorized } from "@/lib/auth";
import { focusForOwner } from "@/lib/focus-data";
import { sendEmail } from "@/lib/gmail";
import { localParts } from "@/lib/local-time";
import { digestEmail, type DigestData } from "@/lib/morning-digest";
import { shouldSendMorningDigest } from "@/lib/morning-messages";
import { isSendDay } from "@/lib/morning-send-rules";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { sendDayStart } from "@/lib/send-guards";
import { sendMorningSlack, type SlackDeskCard } from "@/lib/slack";
import { DESK_STATUSES } from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";
import { seatOwner, type Owner } from "@/lib/types";

type Db = ReturnType<typeof admin>;
const UNSENT = ["new", "edited", "approved"];
const nameOf = (value: unknown, key: string) => String((value as Record<string, unknown> | null)?.[key] ?? "").trim();

/** One seat's numbers for the morning email. Each read degrades to zero on its own, so one missing column
 *  or table never stops the rest of the email. */
async function seatDigest(db: Db, owner: Owner, base: string, now: Date): Promise<DigestData> {
  const dayStart = sendDayStart(now);
  const yesterday = sendDayStart(new Date(dayStart.getTime() - 12 * 3_600_000));
  const tomorrow = sendDayStart(new Date(dayStart.getTime() + 36 * 3_600_000));
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const local = localParts(now);
  const firstDomains = focusForOwner(owner, 1).map((row) => row.domain.toLowerCase());

  const [replies, meetings, list, followups, sent, bounced, batchTouches] = await Promise.all([
    db.from("touches").select("card_id,reply_classification,people(full_name),cards(accounts(name))").eq("sent_by", owner).gte("reply_at", since).neq("reply_classification", "none").limit(50),
    db.from("cards").select("meeting_at,people(full_name),accounts(name)").eq("assigned_to", owner).gte("meeting_at", now.toISOString()).lte("meeting_at", new Date(now.getTime() + 7 * 86_400_000).toISOString()).order("meeting_at").limit(10),
    db.from("reachout_lists").select("status,rows").eq("list_date", local.date).eq("owner", owner).maybeSingle(),
    db.from("cadence_steps").select("id,cadences!inner(owner)", { count: "exact", head: true }).eq("cadences.owner", owner).eq("channel", "email").in("status", ["pending", "ready"]).gte("scheduled_at", dayStart.toISOString()).lt("scheduled_at", tomorrow.toISOString()),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").gte("sent_at", yesterday.toISOString()).lt("sent_at", dayStart.toISOString()),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).gte("bounced_at", yesterday.toISOString()).lt("bounced_at", dayStart.toISOString()),
    firstDomains.length ? db.from("touches").select("cards!inner(accounts!inner(domain))").eq("sent_by", owner).not("sent_at", "is", null).in("cards.accounts.domain", firstDomains).limit(5000) : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set<string>();
  const replyRows = ((replies.data ?? []) as Array<Record<string, unknown>>).filter((row) => !seen.has(String(row.card_id)) && Boolean(seen.add(String(row.card_id))));
  const listRows = ((list.data as { status?: string; rows?: Array<{ domain: string }> } | null)?.status === "ready" ? (list.data as { rows?: Array<{ domain: string }> }).rows ?? [] : null);
  let todaysUnsent = 0;
  if (listRows?.length) {
    const { data: cards } = await db.from("cards").select("status,accounts!inner(domain)").eq("assigned_to", owner).in("accounts.domain", listRows.map((row) => row.domain));
    const sentDomains = new Set(((cards ?? []) as Array<Record<string, unknown>>).filter((card) => !UNSENT.includes(String(card.status))).map((card) => nameOf(card.accounts, "domain")));
    todaysUnsent = listRows.filter((row) => !sentDomains.has(row.domain)).length;
  }
  const emailed = new Set(((batchTouches.data ?? []) as Array<Record<string, unknown>>).map((row) => nameOf((row.cards as Record<string, unknown> | null)?.accounts, "domain").toLowerCase()));
  const listLink = (batch: string) => `${base}/outreach?list=${owner}&batch=${batch}`;

  return {
    seat: owner === "josh" ? "Josh" : "Suuchi",
    replies: replyRows.map((row) => ({ name: nameOf(row.people, "full_name") || "Someone", company: nameOf((row.cards as Record<string, unknown> | null)?.accounts, "name") || "a prospect", kind: String(row.reply_classification) })),
    meetings: ((meetings.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ name: nameOf(row.people, "full_name") || "a prospect", company: nameOf(row.accounts, "name"), at: String(row.meeting_at) })),
    todaysList: listRows ? listRows.length : null,
    todaysUnsent,
    firstBatch: firstDomains.length ? { sent: firstDomains.filter((domain) => emailed.has(domain)).length, total: firstDomains.length } : null,
    followupsToday: followups.count ?? 0,
    sentYesterday: sent.count ?? 0,
    bouncedYesterday: bounced.error ? 0 : bounced.count ?? 0,
    links: { desk: `${base}/outreach?list=${owner}`, today: listLink("today"), first: listLink("1"), followups: `${base}/followups?owner=${owner}` },
    timeZone: process.env.SEND_TIMEZONE ?? "America/New_York",
    sendDay: isSendDay(local.weekday, local.date),
  };
}

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const base = (process.env.APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  await loadNightlyLists(db).catch(() => {});
  const [{ data: cards }, { data: connections }, { data: lists }] = await Promise.all([
    db
      .from("cards")
      .select("id,score,status,channel,why_now,brief,assigned_to,accounts(name),people(full_name,title),signals(summary,source_url,type)")
      .eq("surfaced_on", today)
      .in("status", DESK_STATUSES)
      .order("score", { ascending: false }),
    db.from("gmail_connections").select("owner,email"),
    db.from("reachout_lists").select("owner,status").eq("list_date", localParts().date),
  ]);
  const listStatus = new Map(((lists ?? []) as Array<{ owner: string; status: string }>).map((list) => [list.owner, list.status]));
  const errors: string[] = [];

  // The Slack desk only has something to show when cards were surfaced today; an empty desk is not news.
  let slack: Awaited<ReturnType<typeof sendMorningSlack>> | { delivered: false; reason: string };
  if (!cards?.length) slack = { delivered: false, reason: "no cards surfaced today" };
  else if (!["josh", "suuchi"].some((owner) => shouldSendMorningDigest(owner, listStatus.get(owner)))) slack = { delivered: false, reason: "today's lists are ready; the 7:00 list message covers this morning" };
  else {
    try {
      slack = await sendMorningSlack(cards as unknown as SlackDeskCard[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack delivery failed";
      errors.push(`slack: ${message}`);
      slack = { delivered: false, reason: message };
    }
  }

  const emails: Array<{ owner: string; sent: boolean; subject?: string; reason?: string }> = [];
  for (const connection of connections ?? []) {
    const owner = seatOwner(connection.owner as string);
    if (!owner) continue;
    try {
      const email = digestEmail(await seatDigest(db, owner, base, now));
      if (!email) { emails.push({ owner, sent: false, reason: "nothing to report" }); continue; }
      await sendEmail(owner, `Night Watch <${connection.email as string}>`, connection.email as string, email.subject, email.text, undefined, undefined, email.html);
      emails.push({ owner, sent: true, subject: email.subject });
    } catch (error) {
      errors.push(`${owner}: ${error instanceof Error ? error.message : "Delivery failed"}`);
    }
  }

  return Response.json({ cards: cards?.length ?? 0, emails, slack, errors });
}
