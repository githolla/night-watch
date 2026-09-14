import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";

const OPEN_STATUSES = ["new", "approved", "edited"];

/** Small counts for the sidebar badges: prospects to review today and companies on the reach-out list. */
export async function GET() {
  try {
    await requireUser();
    const db = admin();
    const [today, companies] = await Promise.all([
      db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES),
      db.from("accounts").select("id", { count: "exact", head: true }).eq("status", "active").eq("outreach", true).not("domain", "like", "%.example"),
    ]);
    return Response.json({ today: today.count ?? 0, companies: companies.count ?? 0 });
  } catch {
    return Response.json({ today: 0, companies: 0 });
  }
}
