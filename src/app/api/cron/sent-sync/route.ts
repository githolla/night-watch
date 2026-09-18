import { cronAuthorized } from "@/lib/auth";
import { runSentSync } from "@/lib/sent-sync";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runSentSync();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Sent sync failed" }, { status: 500 });
  }
}
