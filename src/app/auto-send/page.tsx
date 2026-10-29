import { OutreachNav } from "@/components/OutreachNav";
import { AutoSendView } from "@/components/AutoSendView";
import { requireUser } from "@/lib/auth";
import { loadAutoSendView } from "@/lib/autosend-view";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { optOutLine } from "@/lib/opt-out";
import { senderProfile } from "@/lib/sender";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";
import { PageHead, seatName } from "@/components/PageHead";
import "./auto-send.css";

export const dynamic = "force-dynamic";

/** The morning auto-send for one seat: the switch, what happens next, and who gets emailed, in order. */
export default async function AutoSendPage({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  // The nightly lists load alongside sign-in instead of one round trip after it.
  const nightlyLoad = loadNightlyLists(admin()).catch(() => undefined);
  const user = await requireUser();
  await nightlyLoad;
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = seatName(owner);
  const yours = !isAdmin || owner === user.owner;
  const [view, profile] = await Promise.all([loadAutoSendView(owner).catch(() => null), senderProfile(admin(), owner)]);

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <PageHead title={yours ? "Auto-send" : `${name}'s auto-send`} seats={isAdmin ? { current: owner, href: (seat) => `/auto-send?owner=${seat}`, label: "Whose auto-send" } : undefined}>
          Night Watch can send {yours ? "your" : `${name}'s`} ready emails each weekday morning, from {yours ? "your" : "their"} own Gmail. Here is what it will do and who it will email.
        </PageHead>
        <OutreachNav owner={owner} active="queue" />
        {view
          ? <AutoSendView key={owner} owner={owner} plan={view.plan} emails={view.emails} control={view.control} health={view.health} canChange={isAdmin || owner === user.owner} listHref={`/outreach?list=${owner}`} sender={{ fromName: profile.fromName, signature: profile.signature, postalAddress: profile.postalAddress }} optOut={optOutLine()} />
          : <p className="as-empty">Auto-send could not be read just now. Reload the page to try again.</p>}
      </div>
    </main>
  );
}
