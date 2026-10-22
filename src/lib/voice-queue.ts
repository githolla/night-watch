import { admin } from "./supabase/admin.ts";
import { loadCallTasks } from "./call-tasks.ts";
import { currentVoiceFollowup } from "./voice-sent-context.ts";
import { nextVoiceCallAt, validVoiceTimezone, VOICE_PROMPT_VERSION } from "./voice-policy.ts";
import { z } from "zod";

export async function prepareVoiceQueue() {
  const db = admin();
  const [tasks, approvals, suppressions] = await Promise.all([
    loadCallTasks(db, "suuchi"),
    db.from("voice_eligibility").select("person_id,timezone,approved_until,delay_business_days"),
    db.from("voice_suppressions").select("person_id"),
  ]);
  if (approvals.error || suppressions.error) throw new Error("Voice approval and suppression checks are unavailable. Nothing queued.");
  const profiles = z.array(z.object({ person_id: z.uuid(), timezone: z.string(), approved_until: z.string(), delay_business_days: z.number() })).parse(approvals.data);
  const suppressed = new Set((suppressions.data ?? []).map(item => item.person_id));
  let queued = 0;
  const held: Array<{ taskId: string; name: string; reason: string }> = [];
  for (const task of tasks.filter(item => item.plan.status === "pending")) {
    const profile = profiles.find(item => item.person_id === task.personId);
    if (!profile || !validVoiceTimezone(profile.timezone) || Date.parse(profile.approved_until) <= Date.now()) { held.push({ taskId: task.id, name: task.name, reason: "Needs sourced timezone and current calling approval" }); continue; }
    if (suppressed.has(task.personId)) { held.push({ taskId: task.id, name: task.name, reason: "Voice suppressed" }); continue; }
    const digits = task.plan.phone?.number.replace(/\D/g, "") ?? "";
    if (!/^(1\d{10}|\d{10})$/.test(digits)) { held.push({ taskId: task.id, name: task.name, reason: "Needs a valid US phone number" }); continue; }
    try {
      const context = await currentVoiceFollowup(task, profile.timezone);
      if (!context.context.email_subject) throw new Error("Exact sent subject could not be verified; hold for correction");
      const scheduledAt = nextVoiceCallAt(task.plan.firstEmailAt, profile.timezone, profile.delay_business_days);
      const result = await db.from("voice_attempts").upsert({ task_id: task.id, person_id: task.personId, owner: task.owner, mode: "pilot", destination: `+${digits.length === 10 ? "1" : ""}${digits}`, attempt_key: `pilot:${task.id}:${task.plan.firstEmailAt}`, status: "queued", scheduled_at: scheduledAt, eligibility_expires_at: profile.approved_until, prompt_version: VOICE_PROMPT_VERSION, context_snapshot: { ...context.context, contact_timezone: profile.timezone, dispatch_enabled: false, refresh_required_before_dial: true } }, { onConflict: "attempt_key", ignoreDuplicates: true }).select("id");
      if (result.error) throw new Error("An active call or attempt already exists; review before retrying");
      queued += result.data?.length ?? 0;
    } catch (error) { held.push({ taskId: task.id, name: task.name, reason: error instanceof Error ? error.message : "Context verification failed" }); }
  }
  return { queued, held, externalDispatchEnabled: false, message: "Queue only. No prospect calls are placed by this operation." };
}
