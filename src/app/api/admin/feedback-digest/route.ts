import { requireAdmin } from "@/lib/auth";
import { runFeedbackDigest } from "@/lib/feedback-digest";

export const dynamic = "force-dynamic";

/** Admin-triggered "run the feedback digest now" — same logic the twice-daily cron runs. */
export async function POST() {
  try {
    await requireAdmin();
    const result = await runFeedbackDigest();
    return Response.json(result, { status: result.error ? 400 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 400 });
  }
}
