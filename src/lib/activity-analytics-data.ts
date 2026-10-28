import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { activityAnalytics, activityDayWindow } from "./activity-analytics.ts";

const touch = z.object({ id: z.string(), person_id: z.string().nullable(), sent_by: z.string(), sent_at: z.string().nullable(), reply_at: z.string().nullable(), bounced_at: z.string().nullable(), reply_classification: z.string().nullable() });
const call = z.object({ id: z.string(), owner: z.string(), mode: z.string(), status: z.string(), dispatched_at: z.string().nullable(), review_required: z.boolean(), report: z.unknown() });
export async function loadActivityAnalytics(db: SupabaseClient, day: string) {
  const { start, end } = activityDayWindow(day);
  const touches: z.infer<typeof touch>[] = [], calls: z.infer<typeof call>[] = [];
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from("touches").select("id,person_id,sent_by,sent_at,reply_at,bounced_at,reply_classification").eq("channel", "email").not("gmail_thread_id", "is", null).or(`and(sent_at.gte.${start},sent_at.lt.${end}),and(reply_at.gte.${start},reply_at.lt.${end}),and(bounced_at.gte.${start},bounced_at.lt.${end})`).order("id").range(offset, offset + 999);
    if (result.error) throw new Error("Email activity could not be loaded; no summary was sent.");
    const rows = z.array(touch).parse(result.data); touches.push(...rows);
    if (rows.length < 1000) break;
  }
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from("voice_attempts").select("id,owner,mode,status,dispatched_at,review_required,report").eq("mode", "pilot").or(`and(dispatched_at.gte.${start},dispatched_at.lt.${end}),status.in.(queued,creating,active)`).order("id").range(offset, offset + 999);
    if (result.error) throw new Error("Call activity could not be loaded; no summary was sent.");
    const rows = z.array(call).parse(result.data); calls.push(...rows);
    if (rows.length < 1000) break;
  }
  return activityAnalytics(touches, calls, day);
}
