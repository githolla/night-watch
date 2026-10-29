import { z } from "zod";
import { admin } from "./supabase/admin.ts";
import { loadDraftWorkspace } from "./draft-workspace.ts";
import { loadSentTouches } from "./sent-view.ts";
import { loadCallTasks } from "./call-tasks.ts";
import { loadLinkedInTasks, loadLinkedInDone } from "./linkedin-tasks.ts";
import { outreachItems } from "./outreach-workspace.ts";
import type { Owner } from "./types.ts";

const voice = z.object({ id: z.string(), task_id: z.string().nullable(), status: z.string(), destination: z.string(), created_at: z.string(), scheduled_at: z.string().nullable(), dispatched_at: z.string().nullable(), ended_reason: z.string().nullable(), review_required: z.boolean(), context_snapshot: z.record(z.string(), z.unknown()), report: z.unknown() });
export async function loadOutreachWorkspace(owner: Owner, now = new Date()) {
  const db = admin(), since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const results = await Promise.allSettled([
    loadDraftWorkspace(owner), loadSentTouches(owner, 7, now), loadCallTasks(db, owner), loadLinkedInTasks(owner), loadLinkedInDone(owner, now, 7),
    db.from("voice_attempts").select("id,task_id,status,destination,created_at,scheduled_at,dispatched_at,ended_reason,review_required,context_snapshot,report").eq("owner", owner).eq("mode", "pilot").order("created_at", { ascending: false }).limit(1000),
  ]);
  const [drafts, sent, calls, linkedin, done, voices] = results;
  const voiceRows = voices.status === "fulfilled" && !voices.value.error ? z.array(voice).safeParse(voices.value.data) : null;
  const problems = results.flatMap((r, i) => r.status === "rejected" ? [["Drafts", "Email history", "Manual call prep", "LinkedIn tasks", "LinkedIn history", "Call history"][i]] : []);
  if (!voiceRows?.success) problems.push("Call history");
  const items = outreachItems({ owner, drafts: drafts.status === "fulfilled" ? drafts.value.drafts : [], plan: drafts.status === "fulfilled" ? drafts.value.plan : null, sent: sent.status === "fulfilled" ? sent.value.touches.filter(t => t.sentAt >= since) : [], voices: voiceRows?.success ? voiceRows.data : [], manual: calls.status === "fulfilled" ? calls.value : [], linkedin: linkedin.status === "fulfilled" ? linkedin.value : [], linkedinDone: done.status === "fulfilled" ? done.value : [] });
  return { items, problems, emailPlan: drafts.status === "fulfilled" ? drafts.value.plan : null };
}
