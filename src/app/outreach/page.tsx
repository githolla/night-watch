import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { OutreachBoard, type BoardFilters } from "@/components/OutreachBoard";
import { ScanControl } from "@/components/ScanControl";
import { requireUser } from "@/lib/auth";
import { parseStoredAnalysis } from "@/lib/analysis";
import { FAMILY_LABEL, type JobFamily } from "@/lib/job-sweep/classify";
import { CLOSED_STAGES, type OutreachRow, type OutreachStage, isOutreachStage } from "@/lib/outreach";
import { loadRunSummary } from "@/lib/run-status";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { syncTargetAccounts, targetsNeedSync } from "@/lib/sync-targets";
import { nowMs } from "@/lib/time";
import { outreachAccounts, targetAccountByDomain, type TargetAccount } from "@/lib/target-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type LiveAccount = {
  analysis: unknown; analysis_at: string | null;
  id: string; domain: string; name: string; tier: string | null; status: string; outreach: boolean; outreach_manual: boolean | null;
  outreach_stage: string | null; outreach_owner: string | null; outreach_notes: string | null; outreach_updated_at: string | null;
  intel_score: number | null; open_target_roles: number | null; ai_posts: number | null; contacts: number | null; verified_emails: number | null;
  last_change_at: string | null; last_scouted_at: string | null; careers_status: string | null; vertical: string | null; hq_city: string | null; hq_state: string | null; target_titles: string[] | null;
};
type CardRow = { id: string; account_id: string; person_id: string; status: string; score: number; why_now: string };
type TouchRow = { sent_at: string | null; reply_at: string | null; reply_classification: string; cards: { account_id: string } | { account_id: string }[] | null };
type RoleRow = { account_id: string; title: string; family: string; posted_at: string | null };
type PostRow = { account_id: string; author_name: string; author_title: string; topic: string };
type PersonRow = { id: string; account_id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; linkedin_url: string | null };
type SignalRow = { account_id: string; raw: { operating_need?: string; evidence_kind?: string } | null; observed_at: string };
type Params = { q?: string; priority?: string; industry?: string; show?: string; sort?: string };

const LIVE_COLUMNS = "analysis,analysis_at,id,domain,name,tier,status,outreach,outreach_manual,outreach_stage,outreach_owner,outreach_notes,outreach_updated_at,intel_score,open_target_roles,ai_posts,contacts,verified_emails,last_change_at,last_scouted_at,careers_status,vertical,hq_city,hq_state,target_titles";
const OPEN = ["new", "approved", "edited", "snoozed"];
const WEEK_MS = 7 * 86_400_000;

function blankTarget(live: LiveAccount): TargetAccount {
  return {
    rank: 0, name: live.name, domain: live.domain, revenueEstimateUsdM: null, revenueBand: "", employees: null, vertical: live.vertical ?? "", subSegment: "",
    hqCity: live.hq_city ?? "", hqState: live.hq_state ?? "", ownership: "", peSponsor: "", ceo: "", targetTitles: live.target_titles ?? [], aiSignal: "", sourceUrl: "", notes: "", alsoIn: "",
    tier: "B", outreach: true, dropReason: "",
  };
}

function group<T>(rows: T[], key: (row: T) => string) {
  const map = new Map<string, T[]>();
  for (const row of rows) { const k = key(row); const list = map.get(k); if (list) list.push(row); else map.set(k, [row]); }
  return map;
}
function list(items: string[], max: number) {
  const shown = items.slice(0, max);
  return shown.join(", ") + (items.length > max ? ` +${items.length - max}` : "");
}
const LEVEL_RANK: Record<string, number> = { owner: 3, influencer: 2, adjacent: 1, unknown: 0 };

/** The reach-out list, ranked contact-first: each company with why, who, and where it stands. */
export default async function OutreachPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const pending = await pendingMigrations(db);
  if (pending.length) return <MigrationRequired pending={pending} />;
  const params = await searchParams;
  if (await targetsNeedSync(db)) await syncTargetAccounts(db);

  const [live, cards, touches, roles, posts, people, signals, holdRows, openRunRow, lastRunRow] = await Promise.all([
    fetchAll<LiveAccount>((from, to) => db.from("accounts").select(LIVE_COLUMNS).eq("outreach", true).not("domain", "like", "%.example").range(from, to)),
    fetchAll<CardRow>((from, to) => db.from("cards").select("id,account_id,person_id,status,score,why_now").range(from, to)),
    fetchAll<TouchRow>((from, to) => db.from("touches").select("sent_at,reply_at,reply_classification,cards(account_id)").range(from, to)),
    fetchAll<RoleRow>((from, to) => db.from("job_postings").select("account_id,title,family,posted_at").eq("active", true).not("family", "is", null).range(from, to)),
    fetchAll<PostRow>((from, to) => db.from("public_posts").select("account_id,author_name,author_title,topic").range(from, to)),
    fetchAll<PersonRow>((from, to) => db.from("people").select("id,account_id,full_name,title,level,email,email_status,linkedin_url").eq("do_not_contact", false).range(from, to)),
    fetchAll<SignalRow>((from, to) => db.from("signals").select("account_id,raw,observed_at").not("raw->>operating_need", "is", null).range(from, to)),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("outreach", false).not("domain", "like", "%.example").gt("intel_score", 0),
    db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("runs").select("finished_at").eq("status", "complete").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const openRun = openRunRow.data ? await loadRunSummary(db, openRunRow.data.id as string) : null;

  const cardsBy = group(cards, (card) => card.account_id);
  const rolesBy = group(roles, (role) => role.account_id);
  const postsBy = group(posts, (post) => post.account_id);
  const peopleBy = group(people, (person) => person.account_id);
  const signalsBy = group(signals, (signal) => signal.account_id);
  const touchesBy = group(touches.filter((touch) => touch.cards), (touch) => (Array.isArray(touch.cards) ? touch.cards[0] : touch.cards)!.account_id);
  const now = nowMs();

  function build(target: TargetAccount, account: LiveAccount | null): OutreachRow {
    const id = account?.id ?? "";
    const ownCards = cardsBy.get(id) ?? [];
    const ownRoles = (rolesBy.get(id) ?? []).sort((a, b) => (b.posted_at ?? "").localeCompare(a.posted_at ?? ""));
    const ownPosts = postsBy.get(id) ?? [];
    const ownPeople = peopleBy.get(id) ?? [];
    const ownSignals = (signalsBy.get(id) ?? []).sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    const ownTouches = touchesBy.get(id) ?? [];
    const stage: OutreachStage = isOutreachStage(account?.outreach_stage) ? account.outreach_stage : "untouched";
    const openCards = ownCards.filter((card) => OPEN.includes(card.status)).sort((a, b) => b.score - a.score);
    const draft = openCards[0] ?? null;
    const draftPerson = draft ? ownPeople.find((person) => person.id === draft.person_id) : null;

    const analysis = parseStoredAnalysis(account?.analysis);
    const reasons: string[] = [];
    if (analysis?.brief.whyNow) reasons.push(analysis.brief.whyNow.split(/(?<=\.)\s+/).slice(0, 2).join(" "));
    if (ownRoles.length) {
      const families = [...new Set(ownRoles.map((role) => FAMILY_LABEL[role.family as JobFamily] ?? role.family))];
      reasons.push(`Hiring ${ownRoles.length === 1 ? "a" : ownRoles.length} ${list(ownRoles.map((role) => role.title), 2)}${families.length > 1 ? ` (${families.length} areas)` : ""}: work Nine-67 would build a system for instead.`);
    }
    if (ownPosts.length) {
      const authors = [...new Set(ownPosts.map((post) => post.author_name))];
      const topics = [...new Set(ownPosts.map((post) => post.topic).filter(Boolean))];
      reasons.push(`${list(authors, 2)} posted about ${list(topics, 2) || "AI"}.`);
    }
    for (const signal of ownSignals.slice(0, 1)) if (signal.raw?.operating_need) reasons.push(signal.raw.operating_need);
    if (!reasons.length && target.aiSignal) reasons.push(`On file: ${target.aiSignal}.`);

    // Who to write to: the drafted person, else the most senior person with the best reach.
    const reachOf = (person: PersonRow | null | undefined): OutreachRow["whoReach"] => !person ? "none" : person.email_status === "verified" ? "verified" : person.email ? "email" : person.linkedin_url ? "linkedin" : "none";
    const reachRank = { verified: 3, email: 2, linkedin: 1, none: 0 };
    const suggested = analysis?.brief.whoFirst ? ownPeople.find((person) => person.full_name.toLowerCase() === analysis.brief.whoFirst.toLowerCase()) : null;
    const who = draftPerson ?? suggested ?? [...ownPeople].sort((a, b) => (LEVEL_RANK[b.level] ?? 0) - (LEVEL_RANK[a.level] ?? 0) || reachRank[reachOf(b)] - reachRank[reachOf(a)])[0] ?? null;

    const sent = ownTouches.filter((touch) => touch.sent_at).length;
    const replied = ownTouches.filter((touch) => touch.reply_at).length;
    const changedRecently = Boolean(account?.last_change_at && now - Date.parse(account.last_change_at) <= WEEK_MS);
    const intel = account?.intel_score ?? 0;
    const being = !CLOSED_STAGES.has(stage) && stage !== "untouched";
    let rank = (draft ? 100 + draft.score : 0) + (ownSignals.length ? 40 : 0) + intel + (analysis ? analysis.brief.fit * 0.8 : 0) + (target.tier === "A1" ? 8 : 0) + (changedRecently ? 6 : 0) + (who ? reachRank[reachOf(who)] * 4 : 0);
    if (CLOSED_STAGES.has(stage)) rank -= 1000;
    else if (stage === "replied") rank += 60;
    else if (being) rank -= 25;

    const why = reasons.length ? reasons.map((reason) => reason.replace(/\.$/, "")).join(" · ") : account?.careers_status || account?.last_scouted_at ? "Nothing found yet" : "Not scanned yet";
    return {
      id: account?.id ?? null, domain: target.domain, name: target.name, tier: account?.tier ?? target.tier, synced: Boolean(account),
      industry: target.vertical, subSegment: target.subSegment, hqCity: target.hqCity, hqState: target.hqState, ownership: target.ownership, peSponsor: target.peSponsor,
      revenueBand: target.revenueBand, revenueEstimateUsdM: target.revenueEstimateUsdM, employees: target.employees, ceo: target.ceo, targetTitles: target.targetTitles,
      aiSignal: target.aiSignal, notes: target.notes, sourceUrl: target.sourceUrl,
      intelScore: intel, openRoles: ownRoles.length, aiPosts: ownPosts.length, contacts: ownPeople.length, verifiedEmails: ownPeople.filter((person) => person.email_status === "verified").length,
      lastChangeAt: account?.last_change_at ?? null, lastResearchedAt: account?.last_scouted_at ?? null, careersStatus: account?.careers_status ?? null,
      openDossiers: openCards.length, topDossierScore: draft?.score ?? 0, sent, replied, meetings: ownCards.filter((card) => card.status === "meeting").length,
      stage, owner: account?.outreach_owner ?? "", ownerNotes: account?.outreach_notes ?? "", stageUpdatedAt: account?.outreach_updated_at ?? null, manual: account?.outreach_manual === true,
      why, reasons, who: who?.full_name ?? analysis?.brief.whoFirst ?? "", whoTitle: who?.title ?? analysis?.brief.whoFirstTitle ?? "", whoReach: reachOf(who),
      draftCardId: draft?.id ?? null, draftScore: draft?.score ?? 0, draftWhy: draft?.why_now ?? "", rank,
    };
  }

  const liveByDomain = new Map(live.map((account) => [account.domain, account]));
  const rows: OutreachRow[] = [];
  const seen = new Set<string>();
  for (const target of outreachAccounts) { seen.add(target.domain); rows.push(build(target, liveByDomain.get(target.domain) ?? null)); }
  for (const account of live) if (!seen.has(account.domain) && account.status === "active") rows.push(build(targetAccountByDomain.get(account.domain) ?? blankTarget(account), account));

  const initial: BoardFilters = { q: params.q ?? "", priority: params.priority ?? "", industry: params.industry ?? "", show: params.show ?? "", sort: params.sort ?? "next" };
  const activeLive = live.filter((account) => account.status === "active");

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <OutreachBoard rows={rows} heldWithSignal={holdRows.count ?? 0} initial={initial}
        scan={<ScanControl
          listSize={activeLive.length}
          unscanned={activeLive.filter((account) => !account.careers_status && !account.last_scouted_at).length}
          firstPass={!live.some((account) => account.careers_status) && !live.some((account) => account.last_scouted_at)}
          openRun={openRun}
          lastFinishedAt={(lastRunRow.data?.finished_at as string | null) ?? null}
        />} />
    </main>
  </div>;
}
