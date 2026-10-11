import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { curatedDomains } from "@/lib/curated-worklist";
import { waitingReplyCount } from "@/lib/replies-view";
import { seatSummary } from "@/lib/draft-summary";
export async function GET() {
  try {
    const user = await requireUser();
    const [{ count, error }, replies, drafts] = await Promise.all([
      admin().from("cadence_steps").select("id,cadences!inner(status)", { count: "exact", head: true }).eq("kind", "review").in("status", ["pending", "ready"]).lte("scheduled_at", new Date().toISOString()).eq("cadences.status", "active"),
      // Replies still waiting on the signed-in seat: the number beside Replies in the sidebar.
      waitingReplyCount(user.owner).catch(() => 0),
      seatSummary(user.owner).then((summary) => summary.unsent).catch(() => 0),
    ]);
    if (error) throw error;
    return Response.json({ today: curatedDomains().length, companies: curatedDomains().length, followups: count ?? 0, replies, drafts });
  } catch { return Response.json({ today: 0, companies: 0, followups: 0, replies: 0, drafts: 0 }); }
}
