import Link from "next/link";
import { redirect } from "next/navigation";
import { DraftSetup, type DraftSample } from "@/components/DraftSetup";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { speakableCompany } from "@/lib/list-templates";
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

/** Two real drafts, so every change can be shown on actual names before it is applied. */
async function sampleDrafts(owner: Owner): Promise<DraftSample[]> {
  const { data } = await admin().from("cards").select("email_subject,accounts(name),people(full_name)").eq("assigned_to", owner).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).order("updated_at", { ascending: false }).limit(2);
  return ((data ?? []) as unknown as Array<{ email_subject: string | null; accounts: { name: string | null } | null; people: { full_name: string | null } | null }>).map((row) => ({
    first: (row.people?.full_name ?? "").trim().split(/\s+/)[0] || "there",
    company: row.accounts?.name ? speakableCompany(row.accounts.name) : "their company",
    subject: row.email_subject ?? "",
  }));
}

/** Setting up all of one seat's drafts at once, in plain steps; the technical tools stay folded under Advanced. */
export default async function Drafts({ searchParams }: { searchParams: Promise<{ owner?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  // Always one seat: a member's own, or the one an admin picks (their own by default).
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = SEATS.find((seat) => seat.owner === owner)?.name ?? "";
  const [summary, samples] = await Promise.all([seatSummary(owner), sampleDrafts(owner)]);
  const listHref = `/outreach?list=${owner}`;
  const yours = !isAdmin || owner === user.owner;

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Your emails" : `${name}'s emails`}</h1>
            <p>Change all {yours ? "your" : `${name}'s`} unsent emails at once. To change just one, open it on the <Link href={listHref}>Reach-out list</Link>.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose emails">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/drafts?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>

        <section className="drafts-status" aria-label="Where things stand">
          <p><b>{summary.unsent}</b> email{summary.unsent === 1 ? "" : "s"} waiting to send. <b>{summary.sentToday}</b> sent today.
            {summary.noAddress > 0 && <> {summary.noAddress} {summary.noAddress === 1 ? "has" : "have"} no email address yet.</>}</p>
          <Link className="btn primary" href={listHref}>Review and send &rarr;</Link>
        </section>

        <DraftSetup owner={owner} unsent={summary.unsent} samples={samples} listHref={listHref} />

        <details className="drafts-advanced">
          <summary>Advanced tools</summary>
          <p className="drafts-scope">Bigger changes, for when something looks wrong across the whole list. They change {yours ? "your" : `${name}'s`} unsent emails only; sent emails are never touched.</p>
          <RewriteDrafts owner={owner} />
        </details>
      </div>
    </main>
  );
}
