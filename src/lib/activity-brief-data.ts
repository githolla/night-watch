import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { activityDayWindow } from "./activity-analytics.ts";
import { loadActivityAnalytics } from "./activity-analytics-data.ts";
import { activityBriefDates, reportDay, shiftReportDay, type ActivityBrief, type ActivitySchedule } from "./activity-brief.ts";
import { loadSendPlan } from "./send-plan-loader.ts";
import { isSendDay } from "./morning-send-rules.ts";
import { localParts } from "./local-time.ts";

export async function loadActivityBrief(db: SupabaseClient, now = new Date()): Promise<ActivityBrief> {
  const day = localParts(now, "America/New_York").date;
  const dates = activityBriefDates(day);
  const [lastWeek, yesterday, today, josh, suuchi, config] = await Promise.all([
    loadActivityAnalytics(db, dates.weekStart, dates.weekEnd), loadActivityAnalytics(db, dates.yesterday), loadActivityAnalytics(db, day),
    loadSendPlan(db, "josh", now), loadSendPlan(db, "suuchi", now),
    db.from("voice_pilot_config").select("enabled,daily_limit,ends_at").eq("id", true).single(),
  ]);
  if (config.error) throw new Error("Calling schedule controls could not be loaded.");
  const schedule: ActivitySchedule[] = Array.from({ length: 7 }, (_, i) => ["josh", "suuchi"].map(owner => ({ date: shiftReportDay(day, i), owner, emailFollowups: 0, calls: 0 }))).flat();
  let overdueEmails = 0, overdueCalls = 0, failedEmails = 0;
  const step = z.object({ scheduled_at: z.string(), status: z.string(), cadences: z.object({ owner: z.string(), status: z.string() }) });
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from("cadence_steps").select("scheduled_at,status,cadences!inner(owner,status)").eq("channel", "email").in("status", ["pending", "ready", "failed"]).is("sent_at", null).eq("cadences.status", "active").lt("scheduled_at", activityDayWindow(dates.horizon).start).order("id").range(offset, offset + 999);
    if (result.error) throw new Error("Upcoming email steps could not be loaded.");
    const rows = z.array(step).parse(result.data);
    for (const row of rows) {
      if (row.status === "failed") { failedEmails++; continue; }
      const date = reportDay(row.scheduled_at);
      if (date < day) { overdueEmails++; continue; }
      const slot = schedule.find(slot => slot.date === date && slot.owner === row.cadences.owner);
      if (slot) slot.emailFollowups++;
    }
    if (rows.length < 1000) break;
  }
  for (let offset = 0; ; offset += 1000) {
    const result = await db.from("voice_attempts").select("owner,scheduled_at").eq("mode", "pilot").eq("status", "queued").lt("scheduled_at", activityDayWindow(dates.horizon).start).order("id").range(offset, offset + 999);
    if (result.error) throw new Error("Upcoming calls could not be loaded.");
    const rows = z.array(z.object({ owner: z.string(), scheduled_at: z.string() })).parse(result.data);
    for (const row of rows) {
      const date = reportDay(row.scheduled_at);
      if (date < day) { overdueCalls++; continue; }
      const slot = schedule.find(slot => slot.date === date && slot.owner === row.owner);
      if (slot) slot.calls++;
    }
    if (rows.length < 1000) break;
  }
  const nextSendDay = (when: string) => {
    if (when === "today") return day;
    for (let ahead = 1; ahead <= 7; ahead++) {
      const date = shiftReportDay(day, ahead);
      const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      if (isSendDay(weekday, date)) return date;
    }
    return dates.tomorrow;
  };
  return {
    day, generatedAt: now.toISOString(), weekStart: dates.weekStart, weekEnd: dates.weekEnd, lastWeek, yesterday, today,
    schedule, overdueEmails, overdueCalls, failedEmails,
    controls: ([{ owner: "josh", plan: josh }, { owner: "suuchi", plan: suuchi }]).map(({ owner, plan }) => ({ owner, blocker: plan.blocker, dailyCap: plan.dailyCap, newEmails: plan.blocker ? 0 : plan.going, newEmailDay: nextSendDay(plan.when), held: plan.held })),
    callEnabled: Boolean(config.data.enabled) && Date.parse(config.data.ends_at) > now.getTime(), callDailyLimit: config.data.daily_limit,
  };
}
