import { cronAuthorized } from "@/lib/auth";
import { morningEmail } from "@/lib/daily-email";
import { loadMorningEmail } from "@/lib/daily-email-data";
import { sendEmail } from "@/lib/gmail";
import { localParts } from "@/lib/local-time";
import { shouldSendMorningDigest } from "@/lib/morning-messages";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { sendMorningSlack, type SlackDeskCard } from "@/lib/slack";
import { DESK_STATUSES } from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";
import { seatOwner } from "@/lib/types";

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
      const email = morningEmail(await loadMorningEmail(owner, base, now));
      if (!email) { emails.push({ owner, sent: false, reason: "nothing to report" }); continue; }
      await sendEmail(owner, `Night Watch <${connection.email as string}>`, connection.email as string, email.subject, email.text, undefined, undefined, email.html);
      emails.push({ owner, sent: true, subject: email.subject });
    } catch (error) {
      errors.push(`${owner}: ${error instanceof Error ? error.message : "Delivery failed"}`);
    }
  }

  return Response.json({ cards: cards?.length ?? 0, emails, slack, errors });
}
