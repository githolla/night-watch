import { cronAuthorized } from "@/lib/auth";
import { runNightly } from "@/lib/pipeline";

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    // Conservative batch size keeps the scheduled job within Vercel's window.
    return Response.json(await runNightly({ accountLimit: Number(process.env.NIGHTLY_ACCOUNT_LIMIT ?? 3) }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Nightly run failed" }, { status: 500 });
  }
}
