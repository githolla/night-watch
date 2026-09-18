import { requireAdmin } from "@/lib/auth";
import { feedbackIssues } from "@/lib/feedback-digest";

export const dynamic = "force-dynamic";

/** The feedback digest issues and the agent's latest summary comment on each, for the admin view. */
export async function GET() {
  try {
    await requireAdmin();
    const result = await feedbackIssues();
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed", issues: [] }, { status: 400 });
  }
}
