import { redirect } from "next/navigation";
import { requireUser, requireActualUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PageHead } from "@/components/PageHead";
import { RedditDesk } from "@/components/RedditDesk";
import { accessState } from "@/lib/reddit/domain";
import { loadConfig, loadOpportunities, check } from "@/lib/reddit/store";
import { z } from "zod";
export const dynamic = "force-dynamic";
const runsSchema = z.array(z.object({ id: z.string(), status: z.string(), started_at: z.string(), finished_at: z.string().nullable(), report: z.record(z.string(), z.unknown()) }));
export default async function RedditPage() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const actual = await requireActualUser();
  const db = admin();
  const workspace = await loadWorkspace(db).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not load opportunities." }));
  if ("error" in workspace) return <div className="shell"><main className="targets-page"><PageHead title="Reddit opportunities">The discovery workspace is waiting for setup.</PageHead><section className="card"><p>Apply <code>supabase/migrations/0033_reddit_opportunities.sql</code> in Supabase before using this workspace.</p><p role="alert">{workspace.error}</p></section></main></div>;
  return <div className="shell"><main className="targets-page"><PageHead title="Reddit opportunities">Find people asking for help with the work Nine-67 can improve. Review the evidence, contribute useful answers, and track the conversations.</PageHead><RedditDesk {...workspace} access={accessState()} owner={user.owner} isAdmin={actual.role === "admin"} /></main></div>;
}
async function loadWorkspace(db: ReturnType<typeof admin>) {
  const [config, rows, runs] = await Promise.all([loadConfig(db), loadOpportunities(db), db.from("reddit_runs").select("id,status,started_at,finished_at,report").order("started_at", { ascending: false }).limit(10)]);
  check(runs.error);
  return { config, rows, runs: runsSchema.parse(runs.data ?? []), now: Date.now() };
}
