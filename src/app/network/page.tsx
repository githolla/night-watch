import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { RelationshipMap } from "@/components/RelationshipMap";
import { loadPortfolio } from "@/lib/relationship-map/portfolio";
export const dynamic = "force-dynamic";
export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ company?: string; owner?: string }> }) {
  const me = await requireUser(); const params = await searchParams;
  const owner = me.role === "admin" && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : me.owner === "suuchi" ? "suuchi" : "josh";
  const result = await loadPortfolio(admin(), { overview: true, owner }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not load relationships." }));
  return <div className="shell relationship-page"><main className="targets-page"><header className="rm-page-head"><div><span>OUTREACH INTELLIGENCE</span><h1>Lead network</h1></div><p>Your target companies and the records behind every relationship.</p></header>{"error" in result ? <section className="card"><p role="alert">{result.error}</p></section> : <RelationshipMap key={owner} initialCompanies={result.companies} initialGraph={result.graph} initialDomain={params.company} owner={owner} showOwners={me.role === "admin"} />}</main></div>;
}
