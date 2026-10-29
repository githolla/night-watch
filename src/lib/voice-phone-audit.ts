import { z } from "zod";
import { admin } from "./supabase/admin.ts";
import { loadCallTasks, updateCallPlan } from "./call-tasks.ts";
import { dialHref } from "./call-plan.ts";
import { onDomain, safeFetch } from "./evidence-grounding.ts";
import { publishedPhones } from "./phone-research.ts";

export function normalizeVoicePhone(number: string): string | null {
  const href = dialHref(number);
  const digits = href?.slice(4).split(";ext=")[0].replace(/\D/g, "") ?? "";
  return /^1\d{10}$/.test(digits) ? `+${digits}` : /^\d{10}$/.test(digits) ? `+1${digits}` : null;
}

export function parsePhoneLine(value: unknown, number: string) {
  const result = z.object({ phone_number: z.literal(number), valid: z.literal(true), line_type_intelligence: z.object({ type: z.string(), carrier_name: z.string().nullable(), error_code: z.number().nullable() }) }).parse(value);
  if (result.line_type_intelligence.error_code !== null) throw new Error("Carrier lookup did not confirm a line type.");
  return { lineType: result.line_type_intelligence.type, carrier: result.line_type_intelligence.carrier_name };
}

export async function auditVoicePhones(phone: unknown, taskId?: string) {
  const imported = z.object({ twilioAccountSid: z.string().optional(), twilioAuthToken: z.string().optional() }).parse(phone);
  const sid = process.env.TWILIO_ACCOUNT_SID || imported.twilioAccountSid;
  const token = process.env.TWILIO_AUTH_TOKEN || imported.twilioAuthToken;
  if (!sid || !token || !/^AC[a-f0-9]{32}$/i.test(sid)) throw new Error("Twilio credentials are unavailable for line-type checks. No eligibility was changed.");
  const db = admin();
  const tasks = (await loadCallTasks(db)).filter(task => task.plan.status === "pending" && task.plan.phone && (!taskId || task.id === taskId));
  const due = tasks.filter(task => taskId || !task.plan.phoneAudit || Date.now() - Date.parse(task.plan.phoneAudit.checkedAt) > 7 * 86_400_000).slice(0, 5);
  const checked: Array<{ taskId: string; name: string; company: string; number: string; lineType: string; companySourceVerified: boolean }> = [];
  const errors: Array<{ taskId: string; reason: string }> = [];
  for (const task of due) {
    try {
      const number = normalizeVoicePhone(task.plan.phone!.number);
      if (!number) throw new Error("No valid US phone number.");
      const response = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(number)}?Fields=line_type_intelligence`, { headers: { authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }, signal: AbortSignal.timeout(12_000) });
      if (!response.ok) throw new Error(`Carrier lookup failed (${response.status}).`);
      const line = parsePhoneLine(await response.json(), number);
      const sourceUrl = task.plan.phone?.sourceUrl ?? null;
      let companySourceVerified = false;
      if (sourceUrl && task.plan.phone?.kind === "company" && onDomain(sourceUrl, task.domain)) {
        const page = await safeFetch(sourceUrl, undefined, { signal: AbortSignal.timeout(7_000), maxBytes: 1_500_000 });
        companySourceVerified = page.kind === "page" && page.status === 200 && onDomain(page.finalUrl, task.domain) && publishedPhones(page.html, page.finalUrl).some(item => normalizeVoicePhone(item.number) === number);
      }
      const phoneAudit = { number, ...line, companySourceVerified, sourceUrl, checkedAt: new Date().toISOString() };
      await updateCallPlan(db, task.id, current => ({ ...(current ?? task.plan), phoneAudit }));
      checked.push({ taskId: task.id, name: task.name, company: task.company, number, lineType: line.lineType, companySourceVerified });
    } catch (error) {
      errors.push({ taskId: task.id, reason: error instanceof Error ? error.message : "Phone audit failed." });
    }
  }
  return { checked, errors, remaining: Math.max(0, tasks.length - checked.length), message: "Line type and company publication are evidence only; this operation does not grant calling consent or change eligibility." };
}
