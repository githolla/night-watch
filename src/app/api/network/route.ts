import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadRelationshipGraph } from "@/lib/relationship-map/load";
import { loadPortfolio } from "@/lib/relationship-map/portfolio";
import { loadPortfolioMetrics } from "@/lib/relationship-map/metrics";
import { loadTargetCompanies } from "@/lib/relationship-map/targets";
export const maxDuration = 60;
export async function GET(request: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const requestedOwner = params.get("owner");
  const owner = user.role === "admin" && (requestedOwner === "josh" || requestedOwner === "suuchi") ? requestedOwner : user.owner === "suuchi" ? "suuchi" : "josh";
  try {
    if (params.get("scope") === "metrics") return Response.json(await loadPortfolioMetrics(admin(), owner), { headers: { "Cache-Control": "no-store" } });
    if (params.get("scope") === "all") return Response.json(await loadPortfolio(admin(), { owner }), { headers: { "Cache-Control": "no-store" } });
    if (!params.has("domain")) return Response.json({ companies: (await loadTargetCompanies(admin(), owner)).filter((company) => `${company.name} ${company.domain}`.toLowerCase().includes((params.get("q") ?? "").toLowerCase())) }, { headers: { "Cache-Control": "no-store" } });
    const domain = params.get("domain") ?? "";
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(domain)) return Response.json({ error: "Choose a company domain." }, { status: 400 });
    const targets = await loadTargetCompanies(admin(), owner);
    if (!targets.some((company) => company.domain.toLowerCase() === domain.toLowerCase())) return Response.json({ error: "Company is not on this owner’s active outreach lists." }, { status: 404 });
    const graph = await loadRelationshipGraph(admin(), domain);
    return graph ? Response.json({ graph }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Company not found." }, { status: 404 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load relationships." }, { status: 500 }); }
}
