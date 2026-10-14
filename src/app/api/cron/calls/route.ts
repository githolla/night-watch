import { cronAuthorized } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadCallTasks, saveCallPhone, updateCallPlan } from "@/lib/call-tasks";
import { backfillCallPlans } from "@/lib/call-backfill";
import { researchCompanyPhone } from "@/lib/phone-research";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!cronAuthorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = admin();
  const statusOnly = new URL(request.url).searchParams.get("mode") === "status";
  const backfilled = statusOnly ? 0 : await backfillCallPlans(db);
  const tasks = await loadCallTasks(db);
  if (statusOnly) return Response.json({ tasks: tasks.map(task => ({ name: task.name, owner: task.owner, scheduledAt: task.plan.scheduledAt, status: task.plan.status, phone: task.plan.phone, bounced: task.bounced })) });
  let prepared = 0, found = 0;
  const errors: string[] = [];
  const cache = new Map<string, Awaited<ReturnType<typeof researchCompanyPhone>>>();
  const deadline = Date.now() + 220_000;
  for (const task of [...tasks].sort((a, b) => b.plan.firstEmailAt.localeCompare(a.plan.firstEmailAt))) {
    if (task.plan.status !== "pending") continue;
    try {
      await updateCallPlan(db, task.id, current => current ?? task.plan);
      prepared++;
      if (task.plan.phone || (task.plan.phoneSearchedAt && Date.now() - Date.parse(task.plan.phoneSearchedAt) < 7 * 86_400_000) || Date.now() > deadline || cache.size >= 15) continue;
      if (!cache.has(task.domain)) cache.set(task.domain, await researchCompanyPhone(task.domain, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) }));
      const phone = cache.get(task.domain) ?? null;
      await saveCallPhone(db, task, phone);
      if (phone) found++;
    } catch (error) { errors.push(`${task.name}: ${error instanceof Error ? error.message : "Could not prepare call"}`); }
  }
  return Response.json({ tasks: tasks.length, backfilled, prepared, found, errors });
}
