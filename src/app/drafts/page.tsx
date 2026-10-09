import Link from "next/link";
import { redirect } from "next/navigation";
import { DraftReview, type ReviewDraft } from "@/components/DraftReview";
import type { AiFit } from "@/lib/ai-fit";
import { isCuratedDomain } from "@/lib/curated-worklist";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { optOutLine } from "@/lib/opt-out";
import { focusedAccount } from "@/lib/reachout-sort";
import { senderProfile } from "@/lib/sender";
import { DraftSetup, type DraftSample } from "@/components/DraftSetup";
import { DraftsTabs } from "@/components/DraftsTabs";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { speakableCompany } from "@/lib/list-templates";
import { requireUser } from "@/lib/auth";
import { bulkSendable, sendableAddress } from "@/lib/bulk-sendable";
import { sendDayStart } from "@/lib/send-guards";
import { admin } from "@/lib/supabase/admin";
import { LIST_DRAFT_HASH } from "@/lib/draft-scope";
import { isLikelyPersonName } from "@/lib/pipeline";
import type { Owner } from "@/lib/types";

export const dynamic = "force-dynamic";

const SEATS: Array<{ owner: Owner; name: string }> = [{ owner: "josh", name: "Josh" }, { owner: "suuchi", name: "Suuchi" }];
type Person = { full_name: string; email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null;

async function seatSummary(owner: Owner) {
  const db = admin();
  const [{ data }, { count: sentToday }] = await Promise.all([
    db.from("cards").select("id,person_id,people(full_name,email,email_status,email_check,do_not_contact),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).limit(2000),
    db.from("touches").select("id", { count: "exact", head: true }).eq("sent_by", owner).eq("channel", "email").not("gmail_thread_id", "is", null).gte("sent_at", sendDayStart().toISOString()),
  ]);
  const seen = new Set<string>();
  const people = ((data ?? []) as unknown as Array<{ person_id: string; people: Person }>)
    .filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seen.has(row.person_id) && Boolean(seen.add(row.person_id)))
    .map((row) => row.people as NonNullable<Person>);
  const confirmed = people.filter((person) => bulkSendable(person)).length;
  const sendable = people.filter((person) => sendableAddress(person)).length;
  return { unsent: people.length, confirmed, unconfirmed: sendable - confirmed, noAddress: people.length - sendable, sentToday: sentToday ?? 0 };
}

/** Two real drafts, so every change can be shown on actual names before it is applied. */
async function sampleDrafts(owner: Owner): Promise<DraftSample[]> {
  const { data } = await admin().from("cards").select("email_subject,accounts(name),people(full_name),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).order("updated_at", { ascending: false }).limit(2);
  return ((data ?? []) as unknown as Array<{ email_subject: string | null; accounts: { name: string | null } | null; people: { full_name: string | null } | null }>).map((row) => ({
    first: (row.people?.full_name ?? "").trim().split(/\s+/)[0] || "there",
    company: row.accounts?.name ? speakableCompany(row.accounts.name) : "their company",
    subject: row.email_subject ?? "",
  }));
}

/** The same one line the desk shows: the top fit reasons, or the research trigger. */
function whyThisCompany(domain: string | null | undefined): string | null {
  const focused = focusedAccount(domain) as { aiFit?: AiFit; trigger?: { fact?: string } } | undefined;
  const reasons = focused?.aiFit && !focused.aiFit.disqualified ? focused.aiFit.reasons.slice(0, 2).map((reason) => reason.text) : [];
  return reasons.length ? reasons.join(" · ") : focused?.trigger?.fact ?? null;
}

/** Every unsent email for the seat, for the quick review list. */
async function reviewDrafts(owner: Owner): Promise<ReviewDraft[]> {
  const { data } = await admin().from("cards").select("id,person_id,status,updated_at,email_subject,email_body,accounts(name,domain),people(full_name,title,email,email_status,email_check,do_not_contact),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).order("updated_at", { ascending: false }).limit(500);
  type Row = { id: string; person_id: string; status: string; updated_at: string; email_subject: string | null; email_body: string | null; accounts: { name: string | null; domain: string | null } | null; people: { full_name: string; title: string | null; email: string | null; email_status: string | null; email_check: unknown; do_not_contact: boolean | null } | null };
  // Only real people, once each: the same filters as the summary above.
  const seen = new Set<string>();
  return ((data ?? []) as unknown as Row[]).filter((row) => row.people && !row.people.do_not_contact && isLikelyPersonName(row.people.full_name) && !seen.has(row.person_id) && Boolean(seen.add(row.person_id))).map((row) => ({
    id: row.id, status: row.status, updatedAt: row.updated_at, subject: row.email_subject ?? "", body: row.email_body ?? "",
    curated: isCuratedDomain(row.accounts?.domain), why: whyThisCompany(row.accounts?.domain),
    name: row.people!.full_name, title: row.people!.title ?? "", company: row.accounts?.name ?? "", email: row.people!.email,
    confirmed: bulkSendable(row.people!), sendable: sendableAddress(row.people!),
  })).sort((a, b) => a.company.localeCompare(b.company));
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
  // Nightly list rows carry each company's fit reasons; load them before the review list reads them.
  await loadNightlyLists(admin()).catch(() => undefined);
  const [summary, samples, review, profile] = await Promise.all([seatSummary(owner), sampleDrafts(owner), reviewDrafts(owner), senderProfile(admin(), owner)]);
  const listHref = `/outreach?list=${owner}`;
  const yours = !isAdmin || owner === user.owner;

  return (
    <main className="workspace-page drafts-page">
      <div className="feature-center drafts-shell">
        <header className="drafts-head">
          <div>
            <h1>{yours ? "Your emails" : `${name}'s emails`}</h1>
            <p>Change all {yours ? "your" : `${name}'s`} unsent emails at once, then read through them and fix any one right here.</p>
          </div>
          {isAdmin && (
            <nav className="drafts-seats" aria-label="Whose emails">
              {SEATS.map((seat) => <Link key={seat.owner} href={`/drafts?owner=${seat.owner}`} className={owner === seat.owner ? "is-active" : ""}>{seat.name}</Link>)}
            </nav>
          )}
        </header>
        <DraftsTabs owner={owner} active="edit" />

        <section className="drafts-status" aria-label="Where things stand">
          <p><b>{summary.unsent}</b> email{summary.unsent === 1 ? "" : "s"} waiting to send. <b>{summary.sentToday}</b> sent today.
            {summary.noAddress > 0 && <> {summary.noAddress} {summary.noAddress === 1 ? "has" : "have"} no email address yet.</>}</p>
          <span className="drafts-status-actions"><a className="btn" href="#review">Review them here &darr;</a><Link className="btn primary" href={listHref}>Send on the Reach-out list &rarr;</Link></span>
        </section>

        <h2 className="drafts-section-title">Change all your emails at once</h2>
        <DraftSetup owner={owner} unsent={summary.unsent} samples={samples} listHref={listHref} />

        <div id="review" className="drafts-review-anchor"><DraftReview key={owner} drafts={review} listHref={listHref} sender={{ fromName: profile.fromName, signature: profile.signature, postalAddress: profile.postalAddress }} optOut={optOutLine()} /></div>

        <details className="drafts-advanced">
          <summary>Advanced tools</summary>
          <p className="drafts-scope">Bigger changes, for when something looks wrong across the whole list. They change {yours ? "your" : `${name}'s`} unsent emails only; sent emails are never touched.</p>
          <RewriteDrafts owner={owner} />
        </details>
      </div>
    </main>
  );
}
