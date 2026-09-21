import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

/**
 * Type-ahead over the company list for the admin tools: find a company by name or domain so removing one
 * doesn't mean remembering its exact domain. Returns the fields needed to pick the right row confidently.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    if (user.role !== "admin") return Response.json({ error: "Admins only" }, { status: 403 });
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (query.length < 2) return Response.json({ companies: [] });
    // Strip PostgREST or()-filter metacharacters so a search string can't break the filter grammar.
    const safe = query.replace(/[%,()*]/g, " ").trim();
    if (!safe) return Response.json({ companies: [] });

    const db = admin();
    const { data, error } = await db
      .from("accounts")
      .select("id,name,domain,vertical,tier,outreach,status")
      .or(`name.ilike.%${safe}%,domain.ilike.%${safe}%`)
      .order("outreach", { ascending: false })
      .limit(12);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ companies: data ?? [] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search failed" }, { status: 400 });
  }
}
