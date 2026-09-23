import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { curatedDomains } from "@/lib/curated-worklist";
export async function GET() {
  try {
    await requireUser();
    const { count, error } = await admin().from("cadence_steps").select("id,cadences!inner(status)", { count: "exact", head: true }).eq("kind", "review").in("status", ["pending", "ready"]).lte("scheduled_at", new Date().toISOString()).eq("cadences.status", "active");
    if (error) throw error;
    return Response.json({ today: curatedDomains.length, companies: curatedDomains.length, followups: count ?? 0 });
  } catch { return Response.json({ today: 0, companies: 0, followups: 0 }); }
}
