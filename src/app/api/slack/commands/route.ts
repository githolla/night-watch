import { after } from "next/server";
import { loadActivityAnalytics } from "@/lib/activity-analytics-data";
import { activitySlackText } from "@/lib/activity-analytics";
import { localParts } from "@/lib/local-time";
import { configuredBaseUrl } from "@/lib/opt-out";
import { DESK_STATUSES, buildDeskBlocks, slackUserAllowed, verifySlackRequest, type SlackDeskCard } from "@/lib/slack";
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
    if (["stats", "analytics"].includes(text)) {
      const responseUrl = form.get("response_url") ?? "";
      const url = new URL(responseUrl);
      if (url.origin !== "https://hooks.slack.com" || !url.pathname.startsWith("/commands/")) return Response.json({ response_type: "ephemeral", text: "Slack response address could not be verified." });
      after(async () => {
        let message: string;
        try {
          const day = localParts(new Date(), "America/New_York").date;
          message = activitySlackText(await loadActivityAnalytics(admin(), day), day, configuredBaseUrl());
        } catch { message = "Nightwatch could not load complete activity. Try again; missing data has not been reported as zero."; }
        const response = await fetch(responseUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ response_type: "ephemeral", replace_original: true, text: message }), signal: AbortSignal.timeout(10000) });
        if (!response.ok) console.error("Nightwatch Slack analytics response failed.");
      });
      return Response.json({ response_type: "ephemeral", text: "Loading today’s email and call activity…" });
    }
    if (text === "help") {
      return Response.json({
        response_type: "ephemeral",
        text: "Night Watch commands: `/night-watch` or `/night-watch brief` shows today's desk. `/night-watch stats` shows emails, calls, voicemail, bookings and switchboard outcomes for Josh and Suuchi. Use the buttons to approve, snooze, dismiss, track manual sends, and record outcomes.",
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const db = admin();
    const { data, error } = await db
      .from("cards")
      .select("id,score,status,channel,why_now,brief,assigned_to,accounts(name),people(full_name,title),signals(summary,source_url,type)")
      .eq("surfaced_on", today)
      .in("status", DESK_STATUSES)
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
