import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { localParts } from "@/lib/local-time";
import { configuredBaseUrl } from "@/lib/opt-out";
import { loadActivityAnalytics } from "@/lib/activity-analytics-data";
import { activitySlackText } from "@/lib/activity-analytics";
import { postSlackMessage, slackConfigured, slackConnectionStatus } from "@/lib/slack";

export const maxDuration = 120;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const local = localParts(new Date(), "America/New_York");
  const mode = new URL(request.url).searchParams.get("mode");
  if (mode === "status") {
    try { return Response.json(await slackConnectionStatus(), { headers: { "cache-control": "no-store" } }); }
    catch (error) { return Response.json({ connected: false, error: error instanceof Error ? error.message : "Slack connection check failed" }, { status: 503 }); }
  }
  const preview = mode === "preview";
  const manual = mode === "send";
  if (!preview && !manual && (["Sat", "Sun"].includes(local.weekday) || local.hour !== 21 || local.minute >= 30)) return Response.json({ skipped: "Outside the 9pm Eastern weekday summary window" });
  try {
    const db = admin(), stats = await loadActivityAnalytics(db, local.date);
    const text = activitySlackText(stats, local.date, configuredBaseUrl());
    if (preview) return Response.json({ stats, text });
    if (!slackConfigured()) return Response.json({ skipped: "Slack is not configured" });
    if (manual) {
      const connection = await slackConnectionStatus();
      if (!connection.connected) return Response.json(connection, { status: 503 });
    }
    const kind = manual ? "slack-team-activity-manual" : "slack-team-activity";
    const claim = await db.from("seat_notifications").insert({ owner: "josh", kind, key: local.date });
    if (claim.error?.code === "23505") return Response.json({ skipped: "Already posted or delivery requires reconciliation" });
    if (claim.error) throw new Error("Could not reserve the Slack summary. No message sent.");
    // Keep the claim on an uncertain Slack response to avoid duplicate reports.
    if (!await postSlackMessage(text)) throw new Error("Slack delivery was not confirmed; inspect before retrying.");
    return Response.json({ delivered: true, date: local.date, stats });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Activity summary failed" }, { status: 503 });
  }
}
