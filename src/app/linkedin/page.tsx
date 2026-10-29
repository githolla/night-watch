import { OutreachNav } from "@/components/OutreachNav";
import { LinkedInTasks } from "@/components/LinkedInTasks";
import { PageHead, seatName } from "@/components/PageHead";
import { requireUser } from "@/lib/auth";
import { loadLinkedInDone, loadLinkedInTasks } from "@/lib/linkedin-tasks";
import type { Owner } from "@/lib/types";
import "./linkedin.css";

export const dynamic = "force-dynamic";

/** Manual LinkedIn outreach as a task queue: copy the message, open the profile, then mark it sent. */
export default async function LinkedInPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const yours = owner === user.owner;
  const name = seatName(owner);
  const [tasks, done] = await Promise.all([loadLinkedInTasks(owner), loadLinkedInDone(owner).catch(() => [])]);
  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <PageHead title={yours ? "LinkedIn tasks" : `${name}'s LinkedIn tasks`} seats={isAdmin ? { current: owner, href: (seat) => `/linkedin?owner=${seat}`, label: "Whose LinkedIn tasks" } : undefined}>
          LinkedIn messages are sent by hand. For each one: copy the message, open their profile and send it there, then mark it sent here so follow-ups and history stay right.
        </PageHead>
        <OutreachNav owner={owner} active="linkedin" />
        <LinkedInTasks key={owner} tasks={tasks} done={done} canSend={yours} seat={name} />
      </div>
    </main>
  );
}
