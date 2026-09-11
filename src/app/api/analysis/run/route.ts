import { requireUser } from "@/lib/auth";
import { runAnalysis } from "@/lib/analysis-run";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

type Body = { runId?: string; accountIds?: string[]; limit?: number; all?: boolean; force?: boolean };

/** Deep analysis from the page; continued by runId until the run closes. */
export async function POST(request: Request) {
  try {
    await requireUser();
    const body = (await request.json().catch(() => ({}))) as Body;
    const accountIds = Array.isArray(body.accountIds) ? body.accountIds.filter((id): id is string => typeof id === "string") : undefined;
    return Response.json(await runAnalysis({
      source: "analysis_manual",
      runId: typeof body.runId === "string" ? body.runId : undefined,
      accountIds: accountIds?.length ? accountIds : undefined,
      accountLimit: typeof body.limit === "number" ? body.limit : undefined,
      force: body.force === true || Boolean(accountIds?.length),
      resumeIdle: !accountIds?.length,
    }));
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] manual analysis failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: classified.code === "config" ? 503 : 500 });
  }
}
