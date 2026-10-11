import { DraftsTabs } from "@/components/DraftsTabs";
import { SentView } from "@/components/SentView";
import { requireUser } from "@/lib/auth";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { loadSentView } from "@/lib/sent-view";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { PageHead, seatName } from "@/components/PageHead";

export const dynamic = "force-dynamic";

const PERIODS = [1, 7, 30];

/** What one seat sent recently and how it is doing: replies, interest, bounces, who it went to. */
export default async function RecentlySentPage({ searchParams }: { searchParams: Promise<{ owner?: string; days?: string }> }) {
  // The nightly lists load alongside sign-in instead of one round trip after it.
  const nightlyLoad = loadNightlyLists(admin()).catch(() => undefined);
  const user = await requireUser();
  await nightlyLoad;
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const days = PERIODS.includes(Number(params.days)) ? Number(params.days) : 7;
  const name = seatName(owner);
  const yours = !isAdmin || owner === user.owner;
  const stats = await loadSentView(owner, days).catch(() => null);

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <PageHead title={yours ? "Your emails" : `${name}'s emails`} seats={isAdmin ? { current: owner, href: (seat) => `/drafts/sent?owner=${seat}&days=${days}`, label: "Whose emails" } : undefined}>
          What went out from {yours ? "your" : `${name}'s`} Gmail recently and how it is doing. It updates on its own as replies come in.
        </PageHead>
        <DraftsTabs owner={owner} active="sent" />
        {stats
          ? <SentView key={`${owner}-${days}`} owner={owner} stats={stats} listHref={`/outreach?list=${owner}`} updatedAt={new Date().toISOString()} />
          : <p className="as-empty">Sent emails could not be read just now. Reload the page to try again.</p>}
      </div>
    </main>
  );
}
