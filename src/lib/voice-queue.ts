import { excludedCompanyPhone } from "./company-phone-safety.ts";
import { balancedCallTasks, catchupCallAt, nextCapacitySlot } from "./call-queue-scheduling.ts";
import { enrollBusinessCalls } from "./automatic-call-enrollment.ts";
import { normalizeVoicePhone } from "./voice-phone-audit.ts";
import { admin } from "./supabase/admin.ts";
import { loadCallTasks } from "./call-tasks.ts";
import { currentVoiceFollowup } from "./voice-sent-context.ts";
import { nextVoiceCallAt, validVoiceTimezone, VOICE_PROMPT_VERSION } from "./voice-policy.ts";
import { localParts } from "./local-time.ts";
import { z } from "zod";

export async function prepareVoiceQueue() {
  const db = admin();
  const enrollment = await enrollBusinessCalls(db);
  const [tasks, approvals, suppressions] = await Promise.all([
    loadCallTasks(db),
    db.from("voice_eligibility").select("*"),
    db.from("voice_suppressions").select("person_id"),
  ]);
  if (approvals.error || suppressions.error) throw new Error("Calling eligibility and suppression checks are unavailable. Nothing queued.");
  const profiles = z.array(z.object({ person_id: z.uuid(), timezone: z.string(), timezone_source: z.string().nullish(), approved_until: z.string(), delay_business_days: z.number(), approval_basis: z.enum(["written_consent", "reviewed_business_landline"]).nullish(), approval_evidence: z.string().nullish(), approved_number: z.string().nullish() })).parse(approvals.data);
  const attempts = await db.from("voice_attempts").select("attempt_key,status,scheduled_at,dispatched_at").eq("mode", "pilot").limit(10000);
  const config = await db.from("voice_pilot_config").select("daily_limit").eq("id", true).single();
  if (attempts.error || config.error || !config.data?.daily_limit) throw new Error("Could not preserve call history and daily capacity.");
  const known = new Set((attempts.data ?? []).map(attempt => attempt.attempt_key));
  const counts = new Map<string, number>();
  for (const attempt of attempts.data ?? []) {
    const at = attempt.dispatched_at ?? (attempt.status === "queued" ? attempt.scheduled_at : null);
    if (!at) continue;
    const date = localParts(new Date(at), "America/New_York").date;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const suppressed = new Set((suppressions.data ?? []).map(item => item.person_id));
  let queued = 0;
  const held: Array<{ taskId: string; name: string; reason: string }> = [];
  let position = 0;
  for (const task of balancedCallTasks(tasks.filter(item => item.plan.status === "pending"))) {
    const attemptKey = `pilot:${task.id}:${task.plan.firstEmailAt}`;
    if (known.has(attemptKey)) continue;
    const profile = profiles.find(item => item.person_id === task.personId);
    if (!profile || !validVoiceTimezone(profile.timezone) || !profile.timezone_source?.trim() || !Number.isFinite(Date.parse(profile.approved_until)) || Date.parse(profile.approved_until) <= Date.now()) { held.push({ taskId: task.id, name: task.name, reason: "Needs a sourced timezone and current automated-calling eligibility" }); continue; }
    if (suppressed.has(task.personId)) { held.push({ taskId: task.id, name: task.name, reason: "Voice suppressed" }); continue; }
    const destination = normalizeVoicePhone(task.plan.phone?.number ?? "");
    if (!destination || excludedCompanyPhone(destination)) { held.push({ taskId: task.id, name: task.name, reason: "Needs a valid US phone number" }); continue; }
    if (!profile.approval_basis || !profile.approval_evidence?.trim() || profile.approved_number !== destination) { held.push({ taskId: task.id, name: task.name, reason: "Automated-calling eligibility evidence is missing for this phone number" }); continue; }
    try {
      const context = await currentVoiceFollowup(task, profile.timezone);
      if (!context.context.email_subject) throw new Error("Exact sent subject could not be verified; hold for correction");
      const scheduledAt = nextCapacitySlot(catchupCallAt(nextVoiceCallAt(task.plan.firstEmailAt, profile.timezone, profile.delay_business_days), profile.timezone, position++), profile.timezone, counts, config.data.daily_limit);
      const result = await db.from("voice_attempts").upsert({ task_id: task.id, person_id: task.personId, owner: task.owner, mode: "pilot", destination, attempt_key: attemptKey, status: "queued", scheduled_at: scheduledAt, eligibility_expires_at: profile.approved_until, prompt_version: VOICE_PROMPT_VERSION, context_snapshot: { ...context.context, contact_timezone: profile.timezone, dispatch_enabled: false, refresh_required_before_dial: true } }, { onConflict: "attempt_key", ignoreDuplicates: true }).select("id");
      if (result.error) throw new Error("An active call or attempt already exists; review before retrying");
      const added = result.data?.length ?? 0;
      queued += added;
      if (added) { const date = localParts(new Date(scheduledAt), "America/New_York").date; counts.set(date, (counts.get(date) ?? 0) + added); }
    } catch (error) { held.push({ taskId: task.id, name: task.name, reason: error instanceof Error ? error.message : "Context verification failed" }); }
  }
  return { queued, held, enrollment, externalDispatchEnabled: false, message: "Queue only. No prospect calls are placed by this operation." };
}
