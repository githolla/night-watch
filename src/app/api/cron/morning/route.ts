import { cronAuthorized } from "@/lib/auth";
import { sendEmail } from "@/lib/gmail";
import { admin } from "@/lib/supabase/admin";

type ConnectedOwner = "josh" | "jenna";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const [{ data: cards }, { data: connections }] = await Promise.all([
    db
      .from("cards")
      .select("score,accounts(name),people(full_name)")
      .eq("surfaced_on", today)
      .order("score", { ascending: false }),
    db.from("gmail_connections").select("owner,email"),
  ]);

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

  for (const connection of connections ?? []) {
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
    skipped: Math.max(0, 2 - (connections?.length ?? 0)),
    errors,
  });
}
