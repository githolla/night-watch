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
    // Only the two ilike wildcards are removed, so a typed "%" can't match every company. Commas and
    // parentheses are kept: 48 companies have them in their names, and blanking them out of the term
    // ("Smith (Holdings)" -> "Smith  Holdings ") meant those companies could never be found.
    const safe = query.replace(/[%*]/g, "").trim();
    if (!safe) return Response.json({ companies: [] });

    const db = admin();
    const columns = "id,name,domain,vertical,tier,outreach,status";
    // Two filtered reads rather than one .or(): an or() value carrying a comma or a bracket is parsed as
    // filter grammar and breaks the query, and quoting it correctly is easy to get subtly wrong. A plain
    // .ilike() passes the term as a value, so any character in a company name is safe.
    const [byName, byDomain] = await Promise.all([
      db.from("accounts").select(columns).ilike("name", `%${safe}%`).order("outreach", { ascending: false }).limit(12),
      db.from("accounts").select(columns).ilike("domain", `%${safe}%`).order("outreach", { ascending: false }).limit(12),
    ]);
    const failure = byName.error ?? byDomain.error;
    if (failure) return Response.json({ error: failure.message }, { status: 400 });

    type Row = { id: string; name: string; outreach: boolean };
    const merged = new Map<string, Row>();
    for (const row of [...(byName.data ?? []), ...(byDomain.data ?? [])] as Row[]) merged.set(row.id, row);
    // Reach-out companies first (what the admin tools act on), then alphabetical so the list is stable.
    const companies = [...merged.values()]
      .sort((a, b) => Number(b.outreach) - Number(a.outreach) || a.name.localeCompare(b.name))
      .slice(0, 12);
    return Response.json({ companies });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Search failed" }, { status: 400 });
  }
}
