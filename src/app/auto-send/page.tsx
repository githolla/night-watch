import Link from "next/link";
import { AutoSendView } from "@/components/AutoSendView";
import { requireUser } from "@/lib/auth";
import { loadAutoSendView } from "@/lib/autosend-view";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { optOutLine } from "@/lib/opt-out";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

/** The morning auto-send for one seat: the switch, what happens next, and who gets emailed, in order. */
export default async function AutoSendPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";
  const yours = !isAdmin || owner === user.owner;
  // Sector and size come from the list rows, which live in the database.
  await loadNightlyLists(admin()).catch(() => undefined);
  const [view, profile] = await Promise.all([loadAutoSendView(owner).catch(() => null), senderProfile(admin(), owner)]);

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Auto-send" : `${name}'s auto-send`}</h1>
            <p>Night Watch can send {yours ? "your" : `${name}'s`} ready emails each weekday morning, from {yours ? "your" : "their"} own Gmail. Here is what it will do and who it will email.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose auto-send">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/auto-send?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        {view
          ? <AutoSendView key={owner} owner={owner} plan={view.plan} emails={view.emails} control={view.control} canChange={isAdmin || owner === user.owner} listHref={`/outreach?list=${owner}`} sender={{ fromName: profile.fromName, signature: profile.signature, postalAddress: profile.postalAddress }} optOut={optOutLine()} />
          : <p className="as-empty">Auto-send could not be read just now. Reload the page to try again.</p>}
      </div>
    </main>
  );
}
