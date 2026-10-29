import { OutreachNav } from "@/components/OutreachNav";
import { VoicePilotReadiness } from "@/components/VoicePilotReadiness";
import { z } from "zod";
import { OutreachWorkspace } from "@/components/OutreachWorkspace";
import { outreachItems } from "@/lib/outreach-workspace";
import { localParts } from "@/lib/local-time";
import "../engagement/engagement.css";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadCallTasks } from "@/lib/call-tasks";
import { CallQueue } from "@/components/CallQueue";
import { PageHead, seatName } from "@/components/PageHead";
import type { AiFit } from "@/lib/ai-fit";
import { buildCompanyIntel } from "@/lib/call-intel";
import { researchData } from "@/lib/research-data/server";
import { buildCallBrief } from "@/lib/call-brief";
import { allFocus } from "@/lib/focus-data";
import { loadNightlyLists } from "@/lib/nightly-lists";
import type { Owner } from "@/lib/types";
export const dynamic = "force-dynamic";
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ owner?: string; taskId?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const owner: Owner = user.role === "admin" && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  await loadNightlyLists(admin());
  const tasks = await loadCallTasks(admin(), owner);
  const automated = await admin().from("voice_attempts").select("id,task_id,status,destination,created_at,scheduled_at,dispatched_at,ended_reason,review_required,context_snapshot,report").eq("owner", owner).eq("mode", "pilot");
  if (automated.error) throw new Error("Could not verify automatic call assignments. Refresh before making a manual call.");
  const voiceRows = z.array(z.object({ id: z.string(), task_id: z.string().nullable(), status: z.string(), destination: z.string(), created_at: z.string(), scheduled_at: z.string().nullable(), dispatched_at: z.string().nullable(), ended_reason: z.string().nullable(), review_required: z.boolean(), context_snapshot: z.record(z.string(), z.unknown()), report: z.unknown() })).parse(automated.data);
  const activityItems = outreachItems({ owner, drafts: [], plan: null, sent: [], voices: voiceRows, manual: tasks, linkedin: [], linkedinDone: [] });
  const automatedIds = new Set((automated.data ?? []).map(item => String(item.task_id)));
  const manualTasks = tasks.filter(task => !automatedIds.has(task.id));
  const research = researchData();
  const dossiers = [...research.dossiers, ...research.revenueFocusDossiers];
  const focus = allFocus();
  const prepared = manualTasks.map(task => {
    const row = focus.find(row => row.domain.toLowerCase() === task.domain.toLowerCase()) as { sector?: string; reframe?: string; limitations?: string[]; trigger?: { fact?: string; sourceUrl?: string | null }; aiFit?: AiFit; revenue?: { usdMillions?: number | null; year?: number | null; status?: string | null; employees?: number | null } } | undefined;
    const prep = buildCallBrief({ senderName: seatName(owner), person: { full_name: task.name, title: task.title, email: task.email, linkedin_url: null }, account: { name: task.company, domain: task.domain, vertical: row?.sector ?? null, employees: null }, whyNow: task.why, operatingNeed: row?.reframe ?? null, roles: [], posts: [], emailSubject: task.emailSubject, emailBody: task.emailBody, meetingAt: null, history: [{ channel: "email", at: task.plan.firstEmailAt, replied: false, bounced: task.bounced }], research: row ? { sector: row.sector, trigger: row.trigger, sizeLabel: row.revenue?.status === "estimated" && row.revenue.employees ? `About ${row.revenue.employees} employees` : row.revenue?.usdMillions ? `$${row.revenue.usdMillions}M revenue${row.revenue.status ? ` · ${row.revenue.status}` : ""}${row.revenue.year ? ` (${row.revenue.year})` : ""}` : null, workflow: row.reframe, limitations: row.limitations, reasons: row.aiFit?.reasons.map(reason => ({ text: reason.text, url: reason.url })) } : null });
    const intel = buildCompanyIntel({ domain: task.domain, sector: row?.sector, title: task.title, row, dossier: dossiers.find(item => item.domain.toLowerCase() === task.domain.toLowerCase()) });
    return { ...task, prep, intel };
  });
  return <main className="workspace-page drafts-page"><div className="feature-center drafts-shell">
    <PageHead title="Calls" seats={user.role === "admin" ? { current: owner, href: seat => `/calls?owner=${seat}`, label: "Whose calls" } : undefined}>Track Alex’s upcoming calls and call results below. Use the call prep workspace for manual follow-ups. Calls are due the next business day after the first email sends. Bounced emails, replies and opt-outs are excluded.</PageHead>
    <OutreachNav owner={owner} active="calls" />
    <OutreachWorkspace key={owner} variant="calls" items={activityItems} day={localParts(new Date(), "America/New_York").date} updatedAt={new Date().toISOString()} problems={[]} emailPlan={null} />
    {owner === "suuchi" && <VoicePilotReadiness tasks={tasks} now={new Date().getTime()} />}
    <details id="manual-calls" open={Boolean(params.taskId)} className="my-5 rounded-xl border border-stone-200 bg-white p-5"><summary className="cursor-pointer text-sm font-semibold text-stone-800">Manual call prep <span className="ml-2 font-normal text-stone-500">{manualTasks.filter(task => task.plan.status === "pending").length} pending tasks, not scheduled for Alex</span></summary><p className="my-4 text-sm text-stone-500">Use this workspace when you want to place a call yourself. Contacts already assigned to automatic calls are excluded.</p>
    <CallQueue initialTaskId={params.taskId} now={new Date().getTime()} key={`${owner}-${params.taskId ?? "queue"}`} tasks={prepared} canComplete={owner === user.owner} canEdit={owner === user.owner || user.role === "admin"} seat={seatName(owner)} />
    </details>
  </div></main>;
}
