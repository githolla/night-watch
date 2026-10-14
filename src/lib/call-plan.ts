import { z } from "zod";
import { localParts } from "./local-time.ts";

export const phoneEvidence = z.object({ number: z.string().min(7).max(40), kind: z.enum(["direct", "company", "contact"]), sourceUrl: z.string().url().max(2000).refine(value => value.startsWith("https://"), "Use a public HTTPS source URL.").nullable(), checkedAt: z.string(), notes: z.string().max(500).default("") });
export type PhoneEvidence = z.infer<typeof phoneEvidence>;
export const callPlanSchema = z.object({ scheduledAt: z.string().datetime(), firstEmailAt: z.string().datetime(), status: z.enum(["pending", "completed", "skipped"]).default("pending"), phone: phoneEvidence.nullable().default(null), notes: z.string().max(3000).default(""), outcome: z.enum(["connected", "voicemail", "no_answer", "wrong_number", "not_interested"]).nullable().default(null), completedAt: z.string().datetime().nullable().default(null), phoneSearchedAt: z.string().datetime().nullable().default(null) });
export type CallPlan = z.infer<typeof callPlanSchema>;
export function readCallPlan(value: unknown): CallPlan | null { const parsed = callPlanSchema.safeParse(value); return parsed.success ? parsed.data : null; }

/** Use the send's Eastern date, including DST, rather than adding 24 hours to a UTC timestamp. */
export function nextCallDate(sentAt: string): string {
  const sent = new Date(sentAt);
  if (!Number.isFinite(sent.getTime())) throw new Error("A real first-email date is required.");
  const date = new Date(`${localParts(sent, "America/New_York").date}T12:00:00Z`);
  do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
  let due = new Date(`${date.toISOString().slice(0, 10)}T10:00:00Z`);
  for (let i = 0; i < 2; i++) due = new Date(due.getTime() + (10 * 60 - localParts(due, "America/New_York").minutes) * 60_000);
  return due.toISOString();
}
export function newCallPlan(firstEmailAt: string): CallPlan { return { scheduledAt: nextCallDate(firstEmailAt), firstEmailAt, status: "pending", phone: null, notes: "", outcome: null, completedAt: null, phoneSearchedAt: null }; }
export function dialHref(number: string): string | null {
  const clean = number.trim();
  if (!/^\+?[\d\s().-]+(?:\s*(?:ext\.?|x)\s*\d{1,6})?$/i.test(clean)) return null;
  const [base, ext] = clean.split(/\s*(?:ext\.?|x)\s*/i);
  const digits = base.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 7 || digits.replace(/\D/g, "").length > 15) return null;
  return `tel:${digits}${ext ? `;ext=${ext}` : ""}`;
}
