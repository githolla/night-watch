import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PageHead } from "@/components/PageHead";
import { RelationshipMap } from "@/components/RelationshipMap";
import { loadPortfolio } from "@/lib/relationship-map/portfolio";
export const dynamic = "force-dynamic";
export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  await requireUser(); const params = await searchParams;
  const result = await loadPortfolio(admin()).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not load relationships." }));
  return <div className="shell relationship-page"><main className="targets-page"><PageHead title="Relationship explorer">Explore every company, its people, outreach and evidence. Compare industries, revenue and company size.</PageHead>{"error" in result ? <section className="card"><p role="alert">{result.error}</p></section> : <RelationshipMap key={result.graph?.companyId ?? "empty"} initialCompanies={result.companies} initialGraph={result.graph} initialDomain={params.company} />}</main></div>;
}
