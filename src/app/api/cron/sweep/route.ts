import { cronAuthorized } from "@/lib/auth";
import { runSweep } from "@/lib/job-sweep/sweep";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

/**
 * Hourly careers sweep: reads applicant-tracking boards and careers pages
 * directly, no model, and raises hiring signals. Resumes an interrupted
 * sweep before starting a new batch. Tunables live in src/lib/run-config.ts.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runSweep({ source: "sweep" }));
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] scheduled sweep failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: 500 });
  }
}
