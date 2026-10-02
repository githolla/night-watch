import { cronAuthorized } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { localParts } from "@/lib/local-time";
import { shouldSendMorningDigest } from "@/lib/morning-messages";
import { sendMorningSlack, type SlackDeskCard } from "@/lib/slack";
import { DESK_STATUSES } from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";

type ConnectedOwner = "josh";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: cards }, { data: connections }, { data: lists }] = await Promise.all([
    db
      .from("cards")
      .select("id,score,status,channel,why_now,brief,assigned_to,accounts(name),people(full_name,title),signals(summary,source_url,type)")
      .eq("surfaced_on", today)
      .in("status", DESK_STATUSES)
      .order("score", { ascending: false }),
    db.from("gmail_connections").select("owner,email"),
    // Before migration 0027 the table is missing and every seat still gets the digest.
    db.from("reachout_lists").select("owner,status").eq("list_date", localParts().date),
  ]);
  // A seat whose nightly list is ready already had the 7:00 list message; one morning message, not two.
  const listStatus = new Map(((lists ?? []) as Array<{ owner: string; status: string }>).map((list) => [list.owner, list.status]));
  const digestFor = (owner: string) => shouldSendMorningDigest(owner, listStatus.get(owner));

  const top = (cards ?? [])
    .slice(0, 3)
    .map(
      (card, index) =>
        `${index + 1}. ${(card.accounts as unknown as { name: string }).name} — ${(card.people as unknown as { full_name: string }).full_name} (${card.score})`,
    )
    .join("\n");
  const reviewUrl = process.env.APP_URL ?? new URL(request.url).origin;
  const body = `${cards?.length ?? 0} cards are ready in Night Watch.\n\n${top}\n\nReview: ${reviewUrl}`;

  const errors: string[] = [];
  let delivered = 0;

  let slack: Awaited<ReturnType<typeof sendMorningSlack>> | { delivered: false; reason: string };
  if (!["josh", "jenna"].some(digestFor)) {
    slack = { delivered: false, reason: "today's lists are ready; the 7:00 list message covers this morning" };
  } else {
    try {
      slack = await sendMorningSlack((cards ?? []) as unknown as SlackDeskCard[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Slack delivery failed";
      errors.push(`slack: ${message}`);
      slack = { delivered: false, reason: message };
    }
  }

  let listCovered = 0;
  for (const connection of connections ?? []) {
    if (!digestFor(connection.owner as string)) { listCovered += 1; continue; }
    try {
      const owner = connection.owner as ConnectedOwner;
      await sendEmail(
        owner,
        connection.email,
        connection.email,
        `${cards?.length ?? 0} Night Watch cards`,
        body,
      );
      delivered += 1;
    } catch (error) {
      errors.push(
        `${connection.owner}: ${error instanceof Error ? error.message : "Delivery failed"}`,
      );
    }
  }

  return Response.json({
    cards: cards?.length ?? 0,
    delivered,
    slack,
    skipped: Math.max(0, 2 - (connections?.length ?? 0)) + listCovered,
    errors,
  });
}
