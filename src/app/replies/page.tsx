import { RepliesView } from "@/components/RepliesView";
import { requireUser } from "@/lib/auth";
import { loadReplies, NEXT_STEP } from "@/lib/replies-view";
import type { Owner } from "@/lib/types";
import { PageHead, seatName } from "@/components/PageHead";

export const dynamic = "force-dynamic";

/** Every reply for one seat: what they wrote, how it reads, what to do next. */
export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = seatName(owner);
  const yours = !isAdmin || owner === user.owner;
  const { items } = await loadReplies(owner).catch(() => ({ items: [] }));
  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <PageHead title={yours ? "Replies" : `${name}'s replies`} seats={isAdmin ? { current: owner, href: (seat) => `/replies?owner=${seat}`, label: "Whose replies" } : undefined}>
          Everyone who wrote back, with what they said and the next step. Reply from your Gmail thread as usual; follow-ups to them have already stopped.
        </PageHead>
        <RepliesView key={owner} items={items} nextStep={NEXT_STEP} canChange={isAdmin || owner === user.owner} />
      </div>
    </main>
  );
}
