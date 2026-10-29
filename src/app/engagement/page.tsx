import { loadOutreachWorkspace } from "@/lib/outreach-workspace-data";
import { requireUser } from "@/lib/auth";
import { OutreachWorkspace } from "@/components/OutreachWorkspace";
import { OutreachNav } from "@/components/OutreachNav";
import { PageHead } from "@/components/PageHead";
import { localParts } from "@/lib/local-time";
import type { Owner } from "@/lib/types";
import "./engagement.css";

export const dynamic = "force-dynamic";
export default async function Engagement({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser(), params = await searchParams;
  const owner: Owner = user.role === "admin" && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const now = new Date();
  const { items, problems, emailPlan } = await loadOutreachWorkspace(owner, now);
  return <main className="workspace-page drafts-page"><div className="feature-center drafts-shell ow-shell">
    <PageHead title="Outreach overview" seats={user.role === "admin" ? { current: owner, href: seat => `/engagement?owner=${seat}`, label: "Whose outreach" } : undefined}>What went out, what happens next, and what needs you. Email, calls and LinkedIn in one place.</PageHead>
    <OutreachNav owner={owner} active="overview" />
    <OutreachWorkspace key={owner} items={items} day={localParts(now, "America/New_York").date} updatedAt={now.toISOString()} problems={problems} emailPlan={emailPlan} />
  </div></main>;
}
