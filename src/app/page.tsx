import Link from "next/link";
import { redirect } from "next/navigation";
import { HomeView } from "@/components/HomeView";
import { requireUser } from "@/lib/auth";
import { greeting, loadHome } from "@/lib/home-view";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

/** Home: the day at a glance. The Reach-out list stays one click away. */
export default async function Home({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  // Sector names in the newest list and the queue come from the list rows.
  await loadNightlyLists(admin()).catch(() => undefined);
  const data = await loadHome(owner);
  return (
    <main className="workspace-page drafts-page home-page">
      <HomeView data={data} owner={owner} hello={greeting()} today={new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" })} aside={isAdmin ? (
        <nav className="drafts-seats" aria-label="Whose day">
          {SEATS.map((seat) => <Link key={seat.owner} href={`/?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
        </nav>
      ) : undefined} />
    </main>
  );
}
