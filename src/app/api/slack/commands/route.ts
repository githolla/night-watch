import { buildDeskBlocks, slackUserAllowed, verifySlackRequest, type SlackDeskCard } from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackRequest(request, rawBody)) return new Response("Invalid Slack signature", { status: 401 });
  const form = new URLSearchParams(rawBody);
  const userId = form.get("user_id") ?? "";
  if (!slackUserAllowed(userId)) {
    return Response.json({ response_type: "ephemeral", text: "You are not allowed to access the Night Watch desk." });
  }

  try {
    const text = (form.get("text") ?? "brief").trim().toLowerCase();
    if (text === "help") {
      return Response.json({
        response_type: "ephemeral",
        text: "Night Watch commands: `/night-watch` or `/night-watch brief` shows today's desk. Use the buttons to approve, snooze, dismiss, track manual sends, and record outcomes.",
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const db = admin();
    const { data, error } = await db
      .from("cards")
      .select("id,score,status,channel,why_now,brief,assigned_to,accounts(name),people(full_name,title),signals(summary,source_url,type)")
      .eq("surfaced_on", today)
      .order("score", { ascending: false })
      .limit(5);
    if (error) throw error;
    return Response.json({
      response_type: "ephemeral",
      text: `${data?.length ?? 0} Night Watch dossiers are ready.`,
      blocks: buildDeskBlocks((data ?? []) as unknown as SlackDeskCard[], { compact: true }),
    });
  } catch (error) {
    return Response.json({ response_type: "ephemeral", text: `Night Watch could not load the desk: ${error instanceof Error ? error.message : "Unknown error"}` });
  }
}
