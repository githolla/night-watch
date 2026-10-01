import { adminGate } from "@/lib/auth";
import { cancelRun } from "@/lib/pipeline";

export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const denied = await adminGate();
  if (denied) return denied;
  try {
    const { runId } = await params;
    const run = await cancelRun(runId);
    return Response.json({ run });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to stop the run" }, { status: 500 });
  }
}
