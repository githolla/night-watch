import { cronAuthorized } from "@/lib/auth";
import { runNightly } from "@/lib/pipeline";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

/**
 * Scheduled research. Works a time budget inside the execution window and
 * returns with the run still open when companies remain; the next scheduled
 * invocation resumes that run before starting a new batch. Batch size,
 * cooldown and budgets are read from src/lib/run-config.ts only.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runNightly({ source: "scheduled" });
    return Response.json(result);
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] scheduled run failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: 500 });
  }
}
