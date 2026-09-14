import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { apolloConfigured, enrichAccountPeople } from "@/lib/apollo-enrich";

/** Fill verified emails and LinkedIn URLs from Apollo for the people already on file at this company. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    if (!apolloConfigured()) {
      return Response.json({ error: "Apollo is not connected. Set APOLLO_API_KEY in the deployment, then try again." }, { status: 400 });
    }
    const { id } = await context.params;
    const db = admin();
    const { data: account, error } = await db.from("accounts").select("id,domain").eq("id", id).single();
    if (error || !account) return Response.json({ error: "Company not found." }, { status: 404 });
    const result = await enrichAccountPeople(db, account as { id: string; domain: string });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Enrichment failed" }, { status: 400 });
  }
}
