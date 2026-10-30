import { admin } from "./supabase/admin.ts";
import { backfillCallPlans } from "./call-backfill.ts";
import { loadCallTasks, saveCallPhone, updateCallPlan } from "./call-tasks.ts";
import { researchCompanyPhone } from "./phone-research.ts";
import { auditVoicePhones } from "./voice-phone-audit.ts";
import { vapiRequest } from "./vapi.ts";
import { VOICE_BOOKING } from "./voice-booking.ts";
import { z } from "zod";

export async function prepareAutomaticCallBatch() {
  const db = admin();
  const backfilled = await backfillCallPlans(db);
  let tasks = await loadCallTasks(db);
  const attempts = await db.from("voice_attempts").select("task_id,person_id,owner,dispatched_at,ended_reason,report").eq("mode", "pilot").eq("status", "ended").not("dispatched_at", "is", null).limit(5000);
  if (attempts.error) throw new Error("Could not reconcile completed calls before preparing catch-up work.");
  let completed = 0;
  for (const task of tasks.filter(task => task.plan.status === "pending")) {
    const attempt = attempts.data?.find(attempt => attempt.task_id === task.id && attempt.person_id === task.personId && attempt.owner === task.owner);
    if (!attempt) continue;
    await updateCallPlan(db, task.id, current => ({ ...(current ?? task.plan), status: "completed", completedAt: attempt.dispatched_at, notes: (current ?? task.plan).notes }));
    completed++;
  }
  tasks = await loadCallTasks(db);
  const errors: string[] = [];
  let found = 0;
  const missing = tasks.filter(task => task.plan.status === "pending" && (!task.plan.phone || task.plan.phone.kind === "contact") && (!task.plan.phoneSearchedAt || Date.now() - Date.parse(task.plan.phoneSearchedAt) > 86_400_000)).slice(0, 4);
  for (const task of missing) {
    try {
      const phone = await researchCompanyPhone(task.domain, { signal: AbortSignal.timeout(15_000) });
      if (phone && task.plan.phone?.kind === "contact") await updateCallPlan(db, task.id, current => ({ ...(current ?? task.plan), phone, phoneSearchedAt: new Date().toISOString() }));
      else await saveCallPhone(db, task, phone);
      if (phone) found++;
    } catch (error) { errors.push(`${task.company}: ${error instanceof Error ? error.message : "Phone research unavailable"}`); }
  }
  const numbers = z.array(z.object({ id: z.string(), number: z.string() })).parse(await vapiRequest("/phone-number"));
  const linked = numbers.find(number => number.number === VOICE_BOOKING.callerNumber);
  if (!linked) throw new Error("Configure the company calling number before automatic preparation.");
  const phone = await vapiRequest(`/phone-number/${linked.id}`);
  const audit = await auditVoicePhones(phone);
  return { backfilled, completed, researched: missing.length, found, audit, errors };
}
