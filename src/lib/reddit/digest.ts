import type { SupabaseClient } from "@supabase/supabase-js";
import { accessState, briefing } from "./domain.ts";
import { check, loadConfig, loadOpportunities } from "./store.ts";
import type { Need } from "../daily-email.ts";
export async function redditNeeds(db: SupabaseClient, owner: "josh" | "suuchi", base: string, now: number): Promise<Need[]> {
  const config = await loadConfig(db);
  if (!config.enabled) return [];
  const href = `${base}/reddit`;
  if (!accessState().ready) return [{ text: "Reddit collection is enabled but approved access is incomplete. No nightly collection can run yet.", action: "Set up", href }];
  const [rows, result] = await Promise.all([loadOpportunities(db), db.from("reddit_runs").select("status,started_at").order("started_at", { ascending: false }).limit(1)]);
  check(result.error);
  const run = result.data?.[0];
  const brief = briefing(rows, owner, now);
  const needs: Need[] = [];
  if (!run || run.status !== "complete" || Date.parse(run.started_at) < now - 30 * 3600000) needs.push({ text: `Reddit discovery coverage needs review: ${run?.status ?? "no run recorded"}. An incomplete search does not establish that there are no opportunities.`, action: "Check coverage", href });
  if (brief.actToday.length || brief.followup.length || brief.buildNext.length) needs.push({ text: `Reddit: ${brief.actToday.length} recent conversations to review, ${brief.followup.length} watched conversations need follow-up, and ${brief.buildNext.length} recurring problems could guide a useful template or demo.`, action: "Review", href });
  return needs;
}
