import Link from "next/link";
import { redirect } from "next/navigation";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { requireUser } from "@/lib/auth";
import { bulkSendable, sendableAddress } from "@/lib/bulk-sendable";
import { sendDayStart } from "@/lib/send-guards";
import { admin } from "@/lib/supabase/admin";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];
type Person = { email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null;

async function seatSummary(owner: Owner) {
  const db = admin();
  const [{ data }, { count: sentToday }] = await Promise.all([
    db.from("cards").select("id,people(email,email_status,email_check,do_not_contact)").eq("assigned_to", owner).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(5000),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", sendDayStart().toISOString()),
  ]);
  const people = ((data ?? []) as unknown as Array<{ people: Person }>).map((row) => row.people).filter((person): person is NonNullable<Person> => Boolean(person && !person.do_not_contact));
  const confirmed = people.filter((person) => bulkSendable(person)).length;
  const sendable = people.filter((person) => sendableAddress(person)).length;
  return { unsent: people.length, confirmed, unconfirmed: sendable - confirmed, noAddress: people.length - sendable, sentToday: sentToday ?? 0 };
}

/** Everything about setting up and fixing drafts, on its own page instead of a drawer on the reach-out list. */
export default async function Drafts({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  // A member works on their own drafts only; an admin picks a seat or works on both.
  const chosen: Owner | null = isAdmin ? (params.owner === "josh" || params.owner === "suuchi" ? params.owner : null) : user.owner;
  const shown = SEATS.filter((seat) => !chosen || seat.owner === chosen);
  const summaries = await Promise.all(shown.map(async (seat) => ({ ...seat, ...(await seatSummary(seat.owner)) })));

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>Drafts</h1>
            <p>Set up how every unsent email reads, check the whole list for problems, and fix them in one place. To edit a single email, open it on the <Link href="/outreach">Reach-out list</Link>.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose drafts">
              <Link href="/drafts" className={!chosen ? "is-active" : ""}>Both</Link>
              {SEATS.map((seat) => <Link key={seat.owner} href={`/drafts?owner=${seat.owner}`} className={chosen === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>

        <section className="drafts-summary" aria-label="Drafts at a glance">
          {summaries.map((seat) => (
            <div className="drafts-seat-card" key={seat.owner}>
              <h2>{isAdmin ? `${seat.name}'s drafts` : "Your drafts"}</h2>
              <dl>
                <div><dt>Unsent</dt><dd>{seat.unsent}</dd></div>
                <div><dt>Confirmed address</dt><dd className="is-good">{seat.confirmed}</dd></div>
                <div><dt>Unconfirmed address</dt><dd className="is-warn">{seat.unconfirmed}</dd></div>
                <div><dt>No usable address</dt><dd>{seat.noAddress}</dd></div>
                <div><dt>Sent today</dt><dd>{seat.sentToday}</dd></div>
              </dl>
            </div>
          ))}
        </section>

        <nav className="drafts-jump" aria-label="Sections">
          <a href="#setup">Set up</a><a href="#check">Check and fix</a><a href="#ai">Rewrite with AI</a>
        </nav>
        <p className="drafts-scope">These tools change {!chosen ? "both seats' unsent drafts" : isAdmin ? `${shown[0].name}'s unsent drafts` : "your unsent drafts"}. Emails already sent are never touched.</p>
        <RewriteDrafts owner={chosen} />
      </div>
    </main>
  );
}
