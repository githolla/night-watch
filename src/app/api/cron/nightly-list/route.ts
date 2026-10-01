import { cronAuthorized } from "@/lib/auth";
import { runNightlyListBuild } from "@/lib/nightly-list-builder";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Builds tonight's reach-out lists, a slice per invocation; vercel.json runs it every ten minutes overnight. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await runNightlyListBuild(admin()));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Nightly list failed" }, { status: 500 });
  }
}
