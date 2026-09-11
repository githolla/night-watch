import { cronAuthorized } from "@/lib/auth";
import { runAnalysis } from "@/lib/analysis-run";
import { classifyResearchError } from "@/lib/research-errors";

export const maxDuration = 300;

/** Nightly deep analysis of the reach-out companies past their cooldown, hottest first. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runAnalysis({ source: "analysis", accountLimit: 40 }));
  } catch (error) {
    const classified = classifyResearchError(error);
    console.error(`[night-watch] scheduled analysis failed (${classified.code}): ${classified.message}`);
    return Response.json({ error: classified.message, code: classified.code }, { status: 500 });
  }
}
