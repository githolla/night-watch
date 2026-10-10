import Link from "next/link";
import { RepliesView } from "@/components/RepliesView";
import { requireUser } from "@/lib/auth";
import { loadReplies, NEXT_STEP } from "@/lib/replies-view";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

/** Every reply for one seat: what they wrote, how it reads, what to do next. */
export default async function RepliesPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";
  const yours = !isAdmin || owner === user.owner;
  const { items } = await loadReplies(owner).catch(() => ({ items: [] }));
  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Replies" : `${name}'s replies`}</h1>
            <p>Everyone who wrote back, with what they said and the next step. Reply from your Gmail thread as usual; follow-ups to them have already stopped.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose replies">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/replies?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        <RepliesView key={owner} items={items} nextStep={NEXT_STEP} canChange={isAdmin || owner === user.owner} />
      </div>
    </main>
  );
}
