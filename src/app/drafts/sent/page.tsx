import Link from "next/link";
import { DraftsTabs } from "@/components/DraftsTabs";
import { SentView } from "@/components/SentView";
import { requireUser } from "@/lib/auth";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { loadSentView } from "@/lib/sent-view";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];
const PERIODS = [1, 7, 30];

/** What one seat sent recently and how it is doing: replies, interest, bounces, who it went to. */
export default async function RecentlySentPage({ searchParams }: { searchParams: Promise<{ owner?: string; days?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const days = PERIODS.includes(Number(params.days)) ? Number(params.days) : 7;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";
  const yours = !isAdmin || owner === user.owner;
  // Sector and size come from the list rows, which live in the database.
  await loadNightlyLists(admin()).catch(() => undefined);
  const stats = await loadSentView(owner, days).catch(() => null);

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Your emails" : `${name}'s emails`}</h1>
            <p>What went out from {yours ? "your" : `${name}'s`} Gmail recently and how it is doing. It updates on its own as replies come in.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose emails">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/drafts/sent?owner=${seat.owner}&days=${days}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        <DraftsTabs owner={owner} active="sent" />
        {stats
          ? <SentView key={`${owner}-${days}`} owner={owner} stats={stats} listHref={`/outreach?list=${owner}`} updatedAt={new Date().toISOString()} />
          : <p className="as-empty">Sent emails could not be read just now. Reload the page to try again.</p>}
      </div>
    </main>
  );
}
