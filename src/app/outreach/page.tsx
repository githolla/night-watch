import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { OutreachBoard, type BoardFilters, type ReachOutResult } from "@/components/OutreachBoard";
import { ScanControl } from "@/components/ScanControl";
import { requireUser } from "@/lib/auth";
import { type OutreachRow, type OutreachStage, isOutreachStage } from "@/lib/outreach";
import { pendingMigrations } from "@/lib/schema-check";
import { loadRunSummary } from "@/lib/run-status";
import { admin } from "@/lib/supabase/admin";
import { syncTargetAccounts, targetsNeedSync } from "@/lib/sync-targets";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { outreachAccounts, targetAccountByDomain, type TargetAccount } from "@/lib/target-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LiveAccount = {
  id: string; domain: string; name: string; tier: string | null; status: string; outreach: boolean; outreach_manual: boolean | null;
  outreach_stage: string | null; outreach_owner: string | null; outreach_notes: string | null; outreach_updated_at: string | null;
  intel_score: number | null; open_target_roles: number | null; ai_posts: number | null; contacts: number | null; verified_emails: number | null;
  last_change_at: string | null; last_scouted_at: string | null; careers_status: string | null; vertical: string | null; hq_city: string | null; hq_state: string | null; target_titles: string[] | null;
};
type CardRow = { id: string; account_id: string; status: string; score: number; why_now: string; channel: string; people: { full_name: string; title: string } | { full_name: string; title: string }[] | null };
type TouchRow = { sent_at: string | null; reply_at: string | null; reply_classification: string; cards: { account_id: string } | { account_id: string }[] | null };
type Params = { q?: string; priority?: string; industry?: string; show?: string; sort?: string };

const LIVE_COLUMNS = "id,domain,name,tier,status,outreach,outreach_manual,outreach_stage,outreach_owner,outreach_notes,outreach_updated_at,intel_score,open_target_roles,ai_posts,contacts,verified_emails,last_change_at,last_scouted_at,careers_status,vertical,hq_city,hq_state,target_titles";

function blankTarget(live: LiveAccount): TargetAccount {
  return {
    rank: 0, name: live.name, domain: live.domain, revenueEstimateUsdM: null, revenueBand: "", employees: null, vertical: live.vertical ?? "", subSegment: "",
    hqCity: live.hq_city ?? "", hqState: live.hq_state ?? "", ownership: "", peSponsor: "", ceo: "", targetTitles: live.target_titles ?? [], aiSignal: "", sourceUrl: "", notes: "", alsoIn: "",
    tier: "B", outreach: true, dropReason: "",
  };
}

function buildRow(target: TargetAccount, live: LiveAccount | null, dossiers: Map<string, { open: number; top: number; sent: number; replied: number; meetings: number }>): OutreachRow {
  const stats = live ? dossiers.get(live.id) : undefined;
  const stage: OutreachStage = isOutreachStage(live?.outreach_stage) ? live.outreach_stage : "untouched";
  return {
    id: live?.id ?? null,
    domain: target.domain,
    name: target.name,
    tier: live?.tier ?? target.tier,
    synced: Boolean(live),
    industry: target.vertical,
    subSegment: target.subSegment,
    hqCity: target.hqCity,
    hqState: target.hqState,
    ownership: target.ownership,
    peSponsor: target.peSponsor,
    revenueBand: target.revenueBand,
    revenueEstimateUsdM: target.revenueEstimateUsdM,
    employees: target.employees,
    ceo: target.ceo,
    targetTitles: target.targetTitles,
    aiSignal: target.aiSignal,
    notes: target.notes,
    sourceUrl: target.sourceUrl,
    intelScore: live?.intel_score ?? 0,
    openRoles: live?.open_target_roles ?? 0,
    aiPosts: live?.ai_posts ?? 0,
    contacts: live?.contacts ?? 0,
    verifiedEmails: live?.verified_emails ?? 0,
    lastChangeAt: live?.last_change_at ?? null,
    lastResearchedAt: live?.last_scouted_at ?? null,
    careersStatus: live?.careers_status ?? null,
    openDossiers: stats?.open ?? 0,
    topDossierScore: stats?.top ?? 0,
    sent: stats?.sent ?? 0,
    replied: stats?.replied ?? 0,
    meetings: stats?.meetings ?? 0,
    stage,
    owner: live?.outreach_owner ?? "",
    ownerNotes: live?.outreach_notes ?? "",
    stageUpdatedAt: live?.outreach_updated_at ?? null,
    manual: live?.outreach_manual === true,
  };
}

/** The reach-out list: Tier A from the cut, with everything Night Watch knows, searchable and worked by hand. */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const pending = await pendingMigrations(db);
  if (pending.length) return <MigrationRequired pending={pending} />;
  const params = await searchParams;

  // The file is the source of truth. If the database is behind it, write it now rather than asking anyone to press a sync button.
  if (await targetsNeedSync(db)) await syncTargetAccounts(db);

  const [live, cards, touches, holdRows, openRunRow] = await Promise.all([
    fetchAll<LiveAccount>((from, to) => db.from("accounts").select(LIVE_COLUMNS).eq("outreach", true).not("domain", "like", "%.example").range(from, to)),
    fetchAll<CardRow>((from, to) => db.from("cards").select("id,account_id,status,score,why_now,channel,people(full_name,title)").range(from, to)),
    fetchAll<TouchRow>((from, to) => db.from("touches").select("sent_at,reply_at,reply_classification,cards(account_id)").range(from, to)),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("outreach", false).not("domain", "like", "%.example").gt("intel_score", 0),
    db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const openRun = openRunRow.data ? await loadRunSummary(db, openRunRow.data.id as string) : null;

  const dossiers = new Map<string, { open: number; top: number; sent: number; replied: number; meetings: number }>();
  const stat = (accountId: string) => {
    let entry = dossiers.get(accountId);
    if (!entry) { entry = { open: 0, top: 0, sent: 0, replied: 0, meetings: 0 }; dossiers.set(accountId, entry); }
    return entry;
  };
  for (const card of cards) {
    const entry = stat(card.account_id);
    if (["new", "approved", "edited", "snoozed"].includes(card.status)) { entry.open += 1; entry.top = Math.max(entry.top, card.score); }
    if (card.status === "meeting") entry.meetings += 1;
  }
  for (const touch of touches) {
    const card = Array.isArray(touch.cards) ? touch.cards[0] : touch.cards;
    const accountId = card?.account_id;
    if (!accountId) continue;
    const entry = stat(accountId);
    if (touch.sent_at) entry.sent += 1;
    if (touch.reply_at) entry.replied += 1;
  }

  const liveByDomain = new Map(live.map((account) => [account.domain, account]));
  const rows: OutreachRow[] = [];
  const seen = new Set<string>();
  for (const target of outreachAccounts) {
    seen.add(target.domain);
    rows.push(buildRow(target, liveByDomain.get(target.domain) ?? null, dossiers));
  }
  // Companies put on the list by hand, from the hold tiers.
  for (const account of live) {
    if (seen.has(account.domain) || account.status !== "active") continue;
    rows.push(buildRow(targetAccountByDomain.get(account.domain) ?? blankTarget(account), account, dossiers));
  }
  const liveById = new Map(live.map((account) => [account.id, account]));
  // What to act on: every open dossier for a reach-out company, strongest first.
  const results: ReachOutResult[] = cards
    .filter((card) => ["new", "approved", "edited"].includes(card.status) && liveById.has(card.account_id))
    .sort((a, b) => b.score - a.score)
    .map((card) => {
      const account = liveById.get(card.account_id)!;
      const person = Array.isArray(card.people) ? card.people[0] : card.people;
      return { cardId: card.id, domain: account.domain, company: account.name, tier: account.tier ?? "", score: card.score, whyNow: card.why_now, channel: card.channel, person: person?.full_name ?? "", title: person?.title ?? "", stage: isOutreachStage(account.outreach_stage) ? account.outreach_stage : "untouched", owner: account.outreach_owner ?? "" };
    });

  const initial: BoardFilters = { q: params.q ?? "", priority: params.priority ?? "", industry: params.industry ?? "", show: params.show ?? "", sort: params.sort ?? "intel" };

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <OutreachBoard rows={rows} results={results} heldWithSignal={holdRows.count ?? 0} initial={initial}
        scan={<ScanControl listSize={live.filter((account) => account.status === "active").length} firstPass={!live.some((account) => account.careers_status) && !live.some((account) => account.last_scouted_at)} openRun={openRun} />} />
    </main>
  </div>;
}
