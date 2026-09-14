import { requireUser } from "@/lib/auth";
import { recomputeAndSurface } from "@/lib/pipeline";

/** Re-score and re-surface the open cards now: archives anything off-list, stale, or below the bar. */
export async function POST() {
  try {
    await requireUser();
    await recomputeAndSurface();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Refresh failed" }, { status: 400 });
  }
}
