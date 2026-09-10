import { requireUser } from "@/lib/auth";
import { runNightly } from "@/lib/pipeline";
import { classifyResearchError } from "@/lib/research-errors";
import { nightlyBatchSize } from "@/lib/run-config";

export const maxDuration = 300;

type Body = { runId?: string; accountIds?: string[]; limit?: number; populate?: boolean };

/**
 * Start a manual research run, or continue one. The first call creates the
 * run and returns its id; the run panel calls again with that id until the
 * run closes, polling GET /api/nightly/run/[runId] for live rows meanwhile.
 */
export async function POST(request: Request) {
  try {
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as Body;
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id): id is string => typeof id === "string") : undefined;
    const result = await runNightly({
      source: "manual",
      runId: typeof body.runId === "string" ? body.runId : undefined,
      accountIds: accountIds?.length ? accountIds : undefined,
      accountLimit: typeof body.limit === "number" ? body.limit : body.populate ? undefined : nightlyBatchSize(),
      populate: body.populate === true,
    });
    return Response.json(result);
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] manual run failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: classified.code === "config" ? 503 : 500 });
  }
}
