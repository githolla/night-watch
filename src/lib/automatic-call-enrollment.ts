import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { loadCallTasks } from "./call-tasks.ts";
import { importedProspects } from "./prospect-import.ts";
import { businessCallEvidenceProblem, companyLocationTimezone } from "./business-call-policy.ts";
import { normalizeVoicePhone } from "./voice-phone-audit.ts";

export async function enrollBusinessCalls(db: SupabaseClient) {
  const config = await db.from("voice_pilot_config").select("enabled,starts_at,ends_at,booking_test_passed,voicemail_test_passed,optout_test_passed").eq("id", true).single();
  if (config.error) throw new Error("Could not confirm the enabled company-calling policy.");
  const policy = z.object({ enabled: z.literal(true), starts_at: z.string(), ends_at: z.string(), booking_test_passed: z.literal(true), voicemail_test_passed: z.literal(true), optout_test_passed: z.literal(true) }).safeParse(config.data);
  if (!policy.success || Date.parse(policy.data.ends_at) <= Date.now()) return { enrolled: 0, held: [] };
  const tasks = (await loadCallTasks(db)).filter(task => task.plan.status === "pending");
  const prior = await db.from("voice_eligibility").select("*");
  if (prior.error) throw new Error("Could not check existing call eligibility.");
  const people = tasks.length ? await db.from("people").select("id,email_check").in("id", tasks.map(task => task.personId)) : { data: [], error: null };
  if (people.error) throw new Error("Could not load imported company timezone evidence.");
  let enrolled = 0;
  const held: Array<{ taskId: string; reason: string }> = [];
  for (const task of tasks) {
    const phone = task.plan.phone, audit = task.plan.phoneAudit;
    const existing = prior.data?.find(row => row.person_id === task.personId);
    if (existing && Date.parse(existing.approved_until) > Date.now() && existing.approved_number === normalizeVoicePhone(phone?.number ?? "")) continue;
    if (!phone || !audit) { held.push({ taskId: task.id, reason: "Company phone research pending" }); continue; }
    const number = normalizeVoicePhone(phone.number);
    const person = people.data?.find(person => person.id === task.personId);
    const imported = z.object({ callTimezone: z.object({ timezone: z.string(), source: z.string() }) }).safeParse(person?.email_check);
    const company = importedProspects.find(company => company.domain === task.domain);
    const companyZone = company ? companyLocationTimezone(company.hq) : null;
    const timezone = audit.timezone ?? existing?.timezone ?? (imported.success ? imported.data.callTimezone.timezone : null) ?? companyZone;
    const timezoneSource = audit.timezoneSource ?? existing?.timezone_source ?? (imported.success ? imported.data.callTimezone.source : null) ?? (companyZone ? `Operator supplied company HQ: ${company?.hq}; ${company?.executiveSource}` : null);
    const problem = businessCallEvidenceProblem({ kind: phone.kind, number: number ?? "", auditedNumber: audit.number, lineType: audit.lineType, companySourceVerified: audit.companySourceVerified, sourceUrl: audit.sourceUrl, checkedAt: audit.checkedAt, timezone, timezoneSource });
    if (problem) { held.push({ taskId: task.id, reason: problem }); continue; }
    const approvalEvidence = `Operator authorized automatic email-to-company-number follow-ups for both owners. Published company switchboard: ${audit.sourceUrl}. Carrier classification: ${audit.lineType}; checked ${audit.checkedAt}. Ask for ${task.name}. No personal mobile or written-consent claim. Timezone source: ${timezoneSource}.`;
    // The existing database value is a legacy name for reviewed business-line eligibility; retain the actual carrier type in evidence.
    const saved = await db.from("voice_eligibility").upsert({ person_id: task.personId, timezone, timezone_source: timezoneSource, approved_until: policy.data.ends_at, approved_by: "Operator-authorized company-number cadence, 2026-10-29", delay_business_days: 1, approval_basis: "reviewed_business_landline", approval_evidence: approvalEvidence, approved_number: number });
    if (saved.error) throw new Error("Could not save automatic company-number eligibility.");
    enrolled++;
  }
  return { enrolled, held };
}
