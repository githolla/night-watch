import { requireUser } from "@/lib/auth";
import { loadRunSummary } from "@/lib/run-status";
import { admin } from "@/lib/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    await requireUser();
    const { runId } = await params;
    const run = await loadRunSummary(admin(), runId);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ run });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the run" }, { status: 500 });
  }
}
