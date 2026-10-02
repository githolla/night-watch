import { cronAuthorized } from "@/lib/auth";
import { buildFailureText } from "@/lib/morning-messages";
import { claimBuildAlert, runNightlyListBuild } from "@/lib/nightly-list-builder";
import { postSlackMessage } from "@/lib/slack";
import { admin } from "@/lib/supabase/admin";

export const maxDuration = 300;

/** Builds tonight's reach-out lists, a slice per invocation; vercel.json runs it every ten minutes overnight. */
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // Research needs the Anthropic key. Without it the build is switched off, not failing: no runs, no spend
  // and no nightly failure alert. Lists can still be added another way and the morning flow picks them up.
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return Response.json({ skipped: "ANTHROPIC_API_KEY is not set, so the nightly list build is off." });
  try {
    return Response.json(await runNightlyListBuild(admin()));
  } catch (error) {
    // At most one Slack alert a night, however many invocations fail.
    if (await claimBuildAlert(admin()).catch(() => false)) await postSlackMessage(buildFailureText(error)).catch(() => false);
    return Response.json({ error: error instanceof Error ? error.message : "Nightly list failed" }, { status: 500 });
  }
}
