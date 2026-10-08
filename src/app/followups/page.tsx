import Link from "next/link";
import { redirect } from "next/navigation";
import { FollowupQueue, type QueueItem } from "@/components/FollowupQueue";
import { MigrationRequired } from "@/components/MigrationRequired";
import { requireUser } from "@/lib/auth";
import { bulkSendable } from "@/lib/bulk-sendable";
import { refreshLegacyFollowup } from "@/lib/followups";
import { followupState } from "@/lib/next-followups";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

type StepRow = {
  id: string; step_number: number; channel: string; kind: string; subject: string | null; body: string | null; status: string; error: string | null; sent_at: string | null; scheduled_at: string;
  cadences: {
    status: string; owner: string;
    people: { full_name: string; title: string; email: string | null; email_status: string | null; email_check: unknown } | null;
    cards: { accounts: { name: string } | null } | null;
  } | null;
};
type View = "needs" | "upcoming" | "sent";
const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];

/**
 * Every scheduled follow-up for one seat, in plain words. Most go out by themselves; this is where to see what
 * is coming, change one before it goes, or handle the few that are waiting on a person. Each sent email's next
 * follow-up also shows in History.
 */
export default async function Followups({ searchParams }: { searchParams: Promise<{ view?: string; owner?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const schemaCheck = pendingMigrations(admin()).catch(() => []);
  const user = await requireUser();
  const pending = await schemaCheck;
  if (pending.length) return <MigrationRequired pending={pending} />;

  const params = await searchParams;
  const isAdmin = user.role === "admin";
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const db = admin();
  const select = "id,step_number,channel,kind,subject,body,status,error,sent_at,scheduled_at,cadences!inner(status,owner,people(full_name,title,email,email_status,email_check),cards(accounts(name)))";
  const [{ data: waiting, error }, { data: sentRows }] = await Promise.all([
    db.from("cadence_steps").select(select).in("status", ["pending", "ready", "failed"]).is("sent_at", null).eq("cadences.status", "active").eq("cadences.owner", owner).order("scheduled_at", { ascending: true }).limit(500),
    db.from("cadence_steps").select(select).eq("status", "sent").eq("cadences.owner", owner).order("sent_at", { ascending: false }).limit(100),
  ]);
  if (error) throw new Error("Could not load follow-ups. Reload to try again.");

  const now = new Date().getTime();
  const toItem = (row: StepRow): QueueItem | null => {
    const cadence = row.cadences;
    if (!cadence) return null;
    const person = cadence.people;
    const { auto, needsYou } = followupState(row, Boolean(person && bulkSendable(person)), now);
    const company = cadence.cards?.accounts?.name ?? "";
    return {
      stepId: row.id, step: row.step_number, scheduledAt: row.scheduled_at, channel: row.channel, subject: row.subject,
      body: refreshLegacyFollowup(row.body ?? "", { firstName: person?.full_name?.split(/\s+/)[0] ?? "there", company: company || "your team", baseSubject: row.subject ?? "", step: row.step_number, channel: row.channel === "email" ? "email" : "linkedin_message" }),
      auto, needsYou, canAct: cadence.owner === user.owner || isAdmin, canSend: cadence.owner === user.owner,
      person: person?.full_name ?? "Unknown contact", title: person?.title ?? "", company, status: row.status, sentAt: row.sent_at,
    };
  };
  const open = ((waiting ?? []) as unknown as StepRow[]).map(toItem).filter((item): item is QueueItem => Boolean(item));
  const needs = open.filter((item) => item.needsYou);
  const upcoming = open.filter((item) => !item.needsYou);
  const sent = ((sentRows ?? []) as unknown as StepRow[]).map(toItem).filter((item): item is QueueItem => Boolean(item));
  const view: View = params.view === "sent" ? "sent" : params.view === "upcoming" ? "upcoming" : params.view === "needs" ? "needs" : needs.length ? "needs" : "upcoming";
  const shown = view === "needs" ? needs : view === "upcoming" ? upcoming : sent;
  const href = (next: View) => `/followups?view=${next}${isAdmin ? `&owner=${owner}` : ""}`;
  const yours = !isAdmin || owner === user.owner;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Your follow-ups" : `${name}'s follow-ups`}</h1>
            <p>After each first email, two short follow-ups go out as replies in the same thread: 3 and 10 business days later. They stop as soon as someone replies. Most send by themselves; the ones that can&rsquo;t wait here for you.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose follow-ups">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/followups?view=${view}&owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        <section className="draft-review">
          <div className="review-head">
            <div className="review-filters" role="tablist" aria-label="Show">
              <Link role="tab" aria-selected={view === "needs"} className={view === "needs" ? "is-active" : ""} href={href("needs")}>Needs you ({needs.length})</Link>
              <Link role="tab" aria-selected={view === "upcoming"} className={view === "upcoming" ? "is-active" : ""} href={href("upcoming")}>Coming up ({upcoming.length})</Link>
              <Link role="tab" aria-selected={view === "sent"} className={view === "sent" ? "is-active" : ""} href={href("sent")}>Sent</Link>
            </div>
            <p className="fq-hint">{view === "needs" ? "These came due but couldn't go out by themselves, usually because the address isn't confirmed. Open one to send it, change it, or skip it." : view === "upcoming" ? "Open one to read or change it before it goes, skip it, or stop all follow-ups to that person." : "The most recent follow-ups that went out."}</p>
          </div>
          <FollowupQueue key={`${owner}-${view}`} items={shown} sent={view === "sent"} />
        </section>
      </div>
    </main>
  );
}
