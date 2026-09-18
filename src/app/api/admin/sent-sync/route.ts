import { requireAdmin } from "@/lib/auth";
import { runSentSync } from "@/lib/sent-sync";

export const dynamic = "force-dynamic";

/** Admin-triggered "pull Gmail Sent into History now" — same logic the cron runs on a schedule. */
export async function POST() {
  try {
    await requireAdmin();
    const result = await runSentSync();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sync failed" }, { status: 400 });
  }
}
