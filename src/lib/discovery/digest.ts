import type { SupabaseClient } from "@supabase/supabase-js";
import type { Need } from "../daily-email.ts";
import { briefing } from "./domain.ts";
import { check, loadConfig, loadOpportunities } from "./store.ts";
export async function discoveryNeeds(db: SupabaseClient, owner: "josh" | "suuchi", base: string, now: number): Promise<Need[]> {
  if (!(await loadConfig(db)).enabled) return [];
  const [rows, runs] = await Promise.all([loadOpportunities(db), db.from("discovery_runs").select("status,started_at,report").order("started_at", { ascending: false }).limit(1)]);
  check(runs.error);
  const brief = briefing(rows, owner, now); const run = runs.data?.[0];
  const needs: Need[] = [];
  if (brief.actToday.length || brief.followup.length || brief.problems.length) needs.push({ text: `Signal discovery: ${brief.actToday.length} opportunities to review, ${brief.followup.length} follow-ups due, and ${brief.problems.length} recurring problems to explore. Confirm the company before queuing buyer and address research.`, action: "Review", href: `${base}/discovery` });
  const pending = rows.filter((row) => !row.assessment && row.status === "new" && (!row.owner || row.owner === owner)).length;
  if (pending) needs.push({ text: `Signal discovery collected ${pending} source records awaiting analysis. Raw discoveries are available to review; they have not been qualified as leads.`, action: "Open inbox", href: `${base}/discovery` });
  if (!run || run.status === "failed" || Date.parse(run.started_at) < now - 30 * 3600000) needs.push({ text: "Nightly signal discovery needs attention. Check its source coverage before concluding there are no new leads.", action: "Check coverage", href: `${base}/discovery` });
  return needs;
}
