import { requireUser } from "@/lib/auth";
import { backfillHiringDrafts } from "@/lib/job-sweep/sweep";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

/** Draft one reach-out per hiring company from what is already on file. Idempotent; press again to continue. */
export async function POST() {
  try {
    await requireUser();
    return Response.json(await backfillHiringDrafts());
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] draft backfill failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: classified.code === "config" ? 503 : 500 });
  }
}
