import { cronAuthorized } from "@/lib/auth";
import { runFeedbackDigest } from "@/lib/feedback-digest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runFeedbackDigest();
  return Response.json(result, { status: result.error ? 502 : 200 });
}
