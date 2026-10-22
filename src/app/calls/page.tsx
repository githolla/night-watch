import { VoiceActivity } from "@/components/VoiceActivity";
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
export default async function CallsPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const owner: Owner = user.role === "admin" && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  await loadNightlyLists(admin());
  const tasks = await loadCallTasks(admin(), owner);
  const research = researchData();
  const dossiers = [...research.dossiers, ...research.revenueFocusDossiers];
  const focus = allFocus();
  const prepared = tasks.map(task => {
    const row = focus.find(row => row.domain.toLowerCase() === task.domain.toLowerCase()) as { sector?: string; reframe?: string; limitations?: string[]; trigger?: { fact?: string; sourceUrl?: string | null }; aiFit?: AiFit; revenue?: { usdMillions?: number | null; year?: number | null; status?: string | null; employees?: number | null } } | undefined;
    const prep = buildCallBrief({ senderName: seatName(owner), person: { full_name: task.name, title: task.title, email: task.email, linkedin_url: null }, account: { name: task.company, domain: task.domain, vertical: row?.sector ?? null, employees: null }, whyNow: task.why, operatingNeed: row?.reframe ?? null, roles: [], posts: [], emailSubject: task.emailSubject, emailBody: task.emailBody, meetingAt: null, history: [{ channel: "email", at: task.plan.firstEmailAt, replied: false, bounced: task.bounced }], research: row ? { sector: row.sector, trigger: row.trigger, sizeLabel: row.revenue?.status === "estimated" && row.revenue.employees ? `About ${row.revenue.employees} employees` : row.revenue?.usdMillions ? `$${row.revenue.usdMillions}M revenue${row.revenue.status ? ` · ${row.revenue.status}` : ""}${row.revenue.year ? ` (${row.revenue.year})` : ""}` : null, workflow: row.reframe, limitations: row.limitations, reasons: row.aiFit?.reasons.map(reason => ({ text: reason.text, url: reason.url })) } : null });
    const intel = buildCompanyIntel({ domain: task.domain, sector: row?.sector, title: task.title, row, dossier: dossiers.find(item => item.domain.toLowerCase() === task.domain.toLowerCase()) });
    return { ...task, prep, intel };
  });
  return <main className="workspace-page drafts-page"><div className="feature-center drafts-shell">
    <PageHead title="Calls & prep" seats={user.role === "admin" ? { current: owner, href: seat => `/calls?owner=${seat}`, label: "Whose calls" } : undefined}>Review the sent email and company intel, make your follow-up call, then save the outcome. Calls are due the next business day after the first email sends. Bounced emails, replies and opt-outs are excluded.</PageHead>
    <VoiceActivity owner={owner} />
    <CallQueue now={new Date().getTime()} key={owner} tasks={prepared} canComplete={owner === user.owner} canEdit={owner === user.owner || user.role === "admin"} seat={seatName(owner)} />
  </div></main>;
}
