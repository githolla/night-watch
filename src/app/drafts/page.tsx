import { redirect } from "next/navigation";
import { DraftWorkspace } from "@/components/DraftWorkspace";
import { loadNightlyLists } from "@/lib/nightly-lists";
import { optOutLine } from "@/lib/opt-out";
import { senderProfile } from "@/lib/sender";
import { DraftSetup, type DraftSample } from "@/components/DraftSetup";
import { DraftsTabs } from "@/components/DraftsTabs";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { speakableCompany } from "@/lib/list-templates";
import { requireUser } from "@/lib/auth";
import { draftTemplates, seatSummary } from "@/lib/draft-summary";
import { admin } from "@/lib/supabase/admin";
import { LIST_DRAFT_HASH } from "@/lib/draft-scope";
import { loadDraftWorkspace } from "@/lib/draft-workspace";
import type { Owner } from "@/lib/types";
import { PageHead, seatName } from "@/components/PageHead";

export const dynamic = "force-dynamic";

/** Two real drafts, so every change can be shown on actual names before it is applied. */
async function sampleDrafts(owner: Owner): Promise<DraftSample[]> {
  const { data } = await admin().from("cards").select("email_subject,accounts(name),people(full_name),signals!inner(hash)").eq("assigned_to", owner).like("signals.hash", LIST_DRAFT_HASH).in("status", ["new", "edited", "approved"]).not("email_body", "is", null).order("updated_at", { ascending: false }).limit(2);
  return ((data ?? []) as unknown as Array<{ email_subject: string | null; accounts: { name: string | null } | null; people: { full_name: string | null } | null }>).map((row) => ({
    first: (row.people?.full_name ?? "").trim().split(/\s+/)[0] || "there",
    company: row.accounts?.name ? speakableCompany(row.accounts.name) : "their company",
    subject: row.email_subject ?? "",
  }));
}

/** The greeting and subject the seat's unsent drafts use now, so the setup boxes show what is really saved. */

/** Setting up all of one seat's drafts at once, in plain steps; the technical tools stay folded under Advanced. */
export default async function Drafts({ searchParams }: { searchParams: Promise<{ owner?: string; tab?: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  // The nightly lists load alongside sign-in instead of one round trip after it.
  const nightlyLoad = loadNightlyLists(admin()).catch(() => undefined);
  const user = await requireUser();
  await nightlyLoad;
  const isAdmin = user.role === "admin";
  const params = await searchParams;
  // Always one seat: a member's own, or the one an admin picks (their own by default).
  const owner: Owner = isAdmin && (params.owner === "josh" || params.owner === "suuchi") ? params.owner : user.owner;
  const name = seatName(owner);
  const [summary, samples, workspace, profile, templates] = await Promise.all([seatSummary(owner), sampleDrafts(owner), loadDraftWorkspace(owner), senderProfile(admin(), owner), draftTemplates(owner)]);
  const listHref = `/outreach?list=${owner}`;
  const yours = !isAdmin || owner === user.owner;
  const sender = { fromName: profile.fromName, signature: profile.signature, postalAddress: profile.postalAddress };
  const tally = { review: 0, approved: 0, held: 0 };
  for (const draft of workspace.drafts.filter((item) => item.sendable)) tally[draft.held ? "held" : draft.status === "approved" ? "approved" : "review"]++;

  return (
    <main className="workspace-page drafts-page dw-page">
      <div className="feature-center drafts-shell">
        <PageHead title={yours ? "Review your drafts" : `Review ${name}'s drafts`} seats={isAdmin ? { current: owner, href: (seat) => `/drafts?owner=${seat}`, label: "Whose drafts" } : undefined}>
          Approve relevant messages and keep control of what gets sent. {yours ? "Your" : `${name}'s`} {summary.unsent} unsent email{summary.unsent === 1 ? "" : "s"}, {summary.sentToday} sent today.
        </PageHead>
        <DraftsTabs owner={owner} active="edit" />

        <div id="review" className="drafts-review-anchor"><DraftWorkspace key={owner} drafts={workspace.drafts} plan={workspace.plan} owner={owner} sender={sender} optOut={optOutLine()} listHref={listHref} canAct={isAdmin || owner === user.owner} startTab={params.tab} /></div>

        <section id="setup" className="dw-bulk-edit" aria-label="Change all drafts at once">
          <h2 className="drafts-section-title">Change all drafts at once</h2>
          <p className="dw-scope">Changes here apply to all <b>{summary.unsent}</b> unsent drafts for {yours ? "you" : name}: {tally.review} in Needs review, {tally.approved} approved, {tally.held} held{summary.noAddress ? `, and ${summary.noAddress} with no address yet` : ""}. Sent emails are never touched, and {isAdmin ? (owner === "josh" ? "Suuchi's" : "Josh's") : "the other seat's"} drafts are not changed.</p>
          <DraftSetup owner={owner} unsent={summary.unsent} samples={samples} listHref={listHref} current={templates} sender={sender} optOut={optOutLine()} />
          <details className="drafts-advanced">
            <summary>Advanced tools</summary>
            <p className="drafts-scope">Bigger changes, for when something looks wrong across the whole list. They change {yours ? "your" : `${name}'s`} unsent emails only; sent emails are never touched.</p>
            <RewriteDrafts owner={owner} />
          </details>
        </section>
      </div>
    </main>
  );
}
