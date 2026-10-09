import Link from "next/link";
import { AutoSendView } from "@/components/AutoSendView";
import { DraftsTabs } from "@/components/DraftsTabs";
import { requireUser } from "@/lib/auth";
import { loadAutoSendView } from "@/lib/autosend-view";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

/** What the morning auto-send sends next for one seat, read from the run's own queue. */
export default async function AutoSendPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";
  const yours = !isAdmin || owner === user.owner;
  // Sector and size come from the list rows, which live in the database.
  await loadNightlyLists(admin()).catch(() => undefined);
  const view = await loadAutoSendView(owner).catch(() => null);
  const listHref = `/outreach?list=${owner}`;

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Your emails" : `${name}'s emails`}</h1>
            <p>Turn auto-send on or off here, and see exactly what it sends from {yours ? "your" : `${name}'s`} Gmail next, in order.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose emails">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/drafts/auto-send?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        <DraftsTabs owner={owner} active="auto" />
        {view
          ? <AutoSendView key={owner} owner={owner} plan={view.plan} emails={view.emails} control={view.control} canChange={isAdmin || owner === user.owner} listHref={listHref} />
          : <p className="as-empty">The auto-send queue could not be read just now. Reload the page to try again.</p>}
      </div>
    </main>
  );
}
