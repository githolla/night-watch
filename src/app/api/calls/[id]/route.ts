import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadCallTasks, updateCallPlan } from "@/lib/call-tasks";
import { dialHref, phoneEvidence } from "@/lib/call-plan";
import { optOutPerson } from "@/lib/email-suppression";
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), outcome: z.enum(["connected", "voicemail", "no_answer", "wrong_number", "not_interested"]), notes: z.string().max(3000).default("") }),
  z.object({ action: z.literal("skip"), notes: z.string().max(3000).default("") }),
  z.object({ action: z.literal("edit"), scheduledAt: z.string().datetime().optional(), notes: z.string().max(3000).optional(), phone: phoneEvidence.optional() }),
]);
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = input.parse(await request.json());
    const db = admin();
    const task = (await loadCallTasks(db)).find(item => item.id === id);
    if (!task || (task.owner !== user.owner && !(user.role === "admin" && body.action !== "complete"))) return Response.json({ error: "Sign in as the call owner to record this call." }, { status: 403 });
    if (body.action === "edit" && body.phone && (!dialHref(body.phone.number) || !body.phone.sourceUrl)) throw new Error("Add a valid phone number and its public source URL.");
    if (body.action === "complete" && !dialHref(task.plan.phone?.number ?? "")) throw new Error("Add a phone number before recording a call.");
    const plan = await updateCallPlan(db, id, current => {
      const plan = current ?? task.plan;
      if (plan.status !== "pending") throw new Error("This call is already completed or skipped.");
      if (body.action === "edit") return { ...plan, ...(body.scheduledAt ? { scheduledAt: body.scheduledAt } : {}), ...(body.notes !== undefined ? { notes: body.notes } : {}), ...(body.phone ? { phone: body.phone } : {}) };
      return { ...plan, status: body.action === "skip" ? "skipped" : "completed", outcome: body.action === "complete" ? body.outcome : null, notes: body.notes, completedAt: new Date().toISOString() };
    });
    if (body.action === "complete" && body.outcome === "not_interested") await optOutPerson(db, task.personId);
    return Response.json({ ok: true, plan });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not update call" }, { status: 400 }); }
}
