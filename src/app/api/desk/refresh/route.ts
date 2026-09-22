import { requireUser } from "@/lib/auth";
import { recomputeAndSurface } from "@/lib/pipeline";

// This route rescores every open card, checks every contact on file and brings stale drafts back in line
// with the writer. It carried no limit while doing far less than that, so the work added to it would have
// run past the platform default and been killed part-way — the self-healing pass would never have
// finished, silently, which is the worst way for it not to work.
export const maxDuration = 300;

/** Re-score and re-surface the open cards now: archives anything off-list, stale, or below the bar. */
export async function POST() {
  try {
    await requireUser();
    const result = await recomputeAndSurface();
    // Say when there is more to do, rather than reporting a pass that ran out of time as a finished one.
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Refresh failed" }, { status: 400 });
  }
}
