import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { focusForOwner } from "@/lib/focus-data";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { loadSendPlan } from "@/lib/send-plan-loader";
import { waitingReplyCount } from "@/lib/replies-view";
import { seatSummary } from "@/lib/draft-summary";
import { loadCallTasks } from "@/lib/call-tasks";
import { linkedinTaskCount } from "@/lib/linkedin-tasks";
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const requested = new URL(request.url).searchParams.get("owner");
    const owner = user.role === "admin" && (requested === "josh" || requested === "suuchi") ? requested : user.owner;
    await loadNightlyLists(admin());
    const today = focusForOwner(owner, 3);
    const companies = new Set((today.length ? today : focusForOwner(owner, 1)).map(row => row.domain)).size;
    const [{ count, error }, replies, drafts, linkedin, plan, calls] = await Promise.all([
      admin().from("cadence_steps").select("id,cadences!inner(status)", { count: "exact", head: true }).eq("kind", "review").in("status", ["pending", "ready"]).lte("scheduled_at", new Date().toISOString()).eq("cadences.status", "active"),
      // Replies still waiting on the signed-in seat: the number beside Replies in the sidebar.
      waitingReplyCount(owner).catch(() => 0),
      seatSummary(owner).then((summary) => summary.unsent).catch(() => 0),
      linkedinTaskCount(owner).catch(() => 0),
      loadSendPlan(admin(), owner),
      loadCallTasks(admin(), owner).then(tasks => tasks.filter(task => task.plan.status === "pending" && Date.parse(task.plan.scheduledAt) <= Date.now()).length).catch(() => 0),
    ]);
    if (error) throw error;
    return Response.json({ today: companies, companies, queued: plan.blocker ? 0 : plan.going, followups: count ?? 0, replies, drafts, linkedin, calls });
  } catch { return Response.json({ today: 0, companies: 0, followups: 0, replies: 0, drafts: 0, linkedin: 0 }); }
}
