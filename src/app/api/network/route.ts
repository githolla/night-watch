import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadMapCompanies, loadRelationshipGraph } from "@/lib/relationship-map/load";
export async function GET(request: Request) {
  if (!await requireUser().catch(() => null)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  try {
    if (!params.has("domain")) return Response.json({ companies: await loadMapCompanies(admin(), params.get("q") ?? "") }, { headers: { "Cache-Control": "no-store" } });
    const domain = params.get("domain") ?? "";
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(domain)) return Response.json({ error: "Choose a company domain." }, { status: 400 });
    const graph = await loadRelationshipGraph(admin(), domain);
    return graph ? Response.json({ graph }, { headers: { "Cache-Control": "no-store" } }) : Response.json({ error: "Company not found." }, { status: 404 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load relationships." }, { status: 500 }); }
}
