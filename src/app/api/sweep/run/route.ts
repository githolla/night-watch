import { requireUser } from "@/lib/auth";
import { runSweep } from "@/lib/job-sweep/sweep";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

type Body = { runId?: string; accountIds?: string[]; limit?: number; all?: boolean };

/** Manual careers sweep from the desk; the run panel continues it by runId until it closes. */
export async function POST(request: Request) {
  try {
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as Body;
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id): id is string => typeof id === "string") : undefined;
    return Response.json(await runSweep({
      source: "sweep_manual",
      runId: typeof body.runId === "string" ? body.runId : undefined,
      accountIds: accountIds?.length ? accountIds : undefined,
      accountLimit: typeof body.limit === "number" ? body.limit : body.all ? 2000 : undefined,
      ignoreCooldown: body.all === true,
    }));
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] manual sweep failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: classified.code === "config" ? 503 : 500 });
  }
}
