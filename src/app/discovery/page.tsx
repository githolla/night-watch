import { redirect } from "next/navigation";
import { requireUser, requireActualUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PageHead } from "@/components/PageHead";
import { DiscoveryDesk } from "@/components/DiscoveryDesk";
import { loadConfig, loadOpportunities, check } from "@/lib/discovery/store";
import { z } from "zod";
export const dynamic = "force-dynamic";
const runsSchema = z.array(z.object({ id: z.string(), status: z.string(), started_at: z.string(), finished_at: z.string().nullable(), report: z.record(z.string(), z.unknown()) }));
async function loadWorkspace(db: ReturnType<typeof admin>) {
  const [config, rows, runs] = await Promise.all([loadConfig(db), loadOpportunities(db), db.from("discovery_runs").select("id,status,started_at,finished_at,report").order("started_at", { ascending: false }).limit(10)]);
  check(runs.error);
  return { config, rows, runs: runsSchema.parse(runs.data ?? []), now: Date.now(), access: { analysis: Boolean(process.env.ANTHROPIC_API_KEY), sam: Boolean(process.env.SAM_API_KEY), sec: Boolean(process.env.SEC_USER_AGENT) } };
}
export default async function DiscoveryPage() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser(); const actual = await requireActualUser();
  const workspace = await loadWorkspace(admin()).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not load discovery." }));
  if ("error" in workspace) return <div className="shell"><main className="targets-page"><PageHead title="Signal discovery">The new lead discovery workspace is waiting for setup.</PageHead><section className="card"><p>Apply <code>supabase/migrations/0034_open_discovery.sql</code> before opening this workspace.</p><p role="alert">{workspace.error}</p></section></main></div>;
  return <div className="shell"><main className="targets-page"><PageHead title="Signal discovery">Hiring, company changes, buying requests and operator questions, with the original evidence and a clear next step.</PageHead><DiscoveryDesk {...workspace} owner={user.owner} isAdmin={actual.role === "admin"} /></main></div>;
}
