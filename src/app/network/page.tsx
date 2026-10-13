import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PageHead } from "@/components/PageHead";
import { RelationshipMap } from "@/components/RelationshipMap";
import { loadMapCompanies, loadRelationshipGraph } from "@/lib/relationship-map/load";
export const dynamic = "force-dynamic";
async function snapshot(domain: string | undefined) {
  const db = admin(); const companies = await loadMapCompanies(db);
  const selected = domain && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(domain) ? domain : companies[0]?.domain;
  return { companies, graph: selected ? await loadRelationshipGraph(db, selected) : null };
}
export default async function NetworkPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  await requireUser(); const params = await searchParams;
  const result = await snapshot(params.company).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "Could not load relationships." }));
  return <div className="shell relationship-page"><main className="targets-page"><PageHead title="Relationship explorer">Start with a company. Follow the evidence, the people and the outreach that connect to it.</PageHead>{"error" in result ? <section className="card"><p role="alert">{result.error}</p></section> : <RelationshipMap key={result.graph?.companyId ?? "empty"} initialCompanies={result.companies} initialGraph={result.graph} />}</main></div>;
}
