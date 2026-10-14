import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { loadCallTasks } from "@/lib/call-tasks";
import { CallQueue } from "@/components/CallQueue";
import { PageHead, seatName } from "@/components/PageHead";
import type { AiFit } from "@/lib/ai-fit";
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
  const prepared = tasks.map(task => {
    const row = allFocus().find(row => row.domain.toLowerCase() === task.domain.toLowerCase()) as { sector?: string; reframe?: string; limitations?: string[]; aiFit?: AiFit; revenue?: { usdMillions?: number; year?: number } } | undefined;
    const prep = buildCallBrief({ senderName: seatName(owner), person: { full_name: task.name, title: task.title, email: task.email, linkedin_url: null }, account: { name: task.company, domain: task.domain, vertical: row?.sector ?? null, employees: null }, whyNow: task.why, operatingNeed: row?.reframe ?? null, roles: [], posts: [], emailSubject: task.emailSubject, emailBody: task.emailBody, meetingAt: null, history: [{ channel: "email", at: task.plan.firstEmailAt, replied: false, bounced: task.bounced }], research: row ? { sector: row.sector, sizeLabel: row.revenue?.usdMillions ? `$${row.revenue.usdMillions}M revenue${row.revenue.year ? ` (${row.revenue.year})` : ""}` : null, workflow: row.reframe, limitations: row.limitations, reasons: row.aiFit?.reasons.map(reason => ({ text: reason.text, url: reason.url })) } : null });
    return { ...task, prep };
  });
  return <main className="workspace-page drafts-page"><div className="feature-center drafts-shell">
    <PageHead title="Calls & prep" seats={user.role === "admin" ? { current: owner, href: seat => `/calls?owner=${seat}`, label: "Whose calls" } : undefined}>A call is set for 10am Eastern on the next business day after the first email actually sends. Review the prep, call by hand, then save the outcome. Replies and opt-outs remove cold-call tasks.</PageHead>
    <CallQueue now={new Date().getTime()} key={owner} tasks={prepared} canComplete={owner === user.owner} canEdit={owner === user.owner || user.role === "admin"} seat={seatName(owner)} />
  </div></main>;
}
