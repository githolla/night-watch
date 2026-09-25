import { publishedEmailPatch } from "@/lib/focused-contact";
import { wasAutomaticallyArchived } from "@/lib/curated-card-state";
import { senderProfile } from "@/lib/sender";
import { outreachFooterHtml, senderFirstName } from "@/lib/outreach-ending";
import { recipientResearch } from "@/lib/recipient-research";
import { preparePriorityDraft } from "@/lib/prepare-priority-draft";
import { createHash } from "node:crypto";
import { reachoutList } from "@/lib/focus-data";
import { batchProgress, selectedBatch } from "@/lib/reachout-batches";
import { RefreshDraftCopy } from "@/components/RefreshDraftCopy";
import { Desk, type DeskContext } from "@/components/Desk";
import { ScanControl } from "@/components/ScanControl";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { RewriteDrafts } from "@/components/RewriteDrafts";
import { ToolDrawer } from "@/components/ToolDrawer";
import { maxCostPerAccountUsd, nightlyBatchSize, populateConfig, populateSweepConfig, sweepAccountLimit } from "@/lib/run-config";
import { latestRunSummary, loadRunSummary, SWEEP_SOURCES } from "@/lib/run-status";
import { isLikelyPersonName } from "@/lib/pipeline";
import { admin } from "@/lib/supabase/admin";
import { deskCoverage } from "@/lib/desk-coverage";
import { activeTargetAccounts } from "@/lib/target-accounts";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
// Allow the one-time preparation of newly selected companies to finish.
export const maxDuration = 60;

type Params = { list?: string; batch?: string; card?: string; status?: string; priority?: string; new?: string; source?: string; account?: string };

/** Card statuses a salesperson still has to decide on. */
const OPEN_STATUSES = ["new", "approved", "edited"];

// Overview metrics are shared workspace summaries, not editable drafts. Coalesce rapid
// navigations for 30 seconds; the selected cards and mailbox are always read fresh.
let overviewCache: { day:string; expires:number; value:ReturnType<typeof fetchOverview> } | undefined;
function fetchOverview(today:string,yesterday:string){const db=admin();return Promise.all([
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example").not("last_scouted_at", "is", null),
    deskCoverage(db),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES).eq("surfaced_on", today),
    db.from("cards").select("*", { count: "exact", head: true }).eq("status", "sent"),
    db.from("signals").select("type,summary,source_url,observed_at,raw,accounts(name,domain),people(full_name,title)").order("found_at", { ascending: false }).limit(8),
    latestRunSummary(db),
    latestRunSummary(db, SWEEP_SOURCES),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("careers_checked_at", "is", null),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("careers_status", "none"),
    db.from("job_postings").select("*", { count: "exact", head: true }).eq("active", true).not("family", "is", null).gte("first_seen_at", yesterday),
    db.from("job_postings").select("*", { count: "exact", head: true }).eq("active", false).not("family", "is", null).gte("updated_at", yesterday),
    db.from("public_posts").select("*", { count: "exact", head: true }).gte("created_at", yesterday),
    db.from("people").select("*", { count: "exact", head: true }).gte("created_at", yesterday),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").gte("last_change_at", yesterday),
    db.from("runs").select("id").eq("status", "open").eq("cancel_requested", false).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("runs").select("finished_at").eq("status", "complete").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("outreach", true).not("domain", "like", "%.example").is("careers_checked_at", null).is("last_scouted_at", null),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("outreach", true).not("domain", "like", "%.example"),
    db.from("public_posts").select("*", { count: "exact", head: true }),
]);}
function loadOverview(today:string,yesterday:string){
 if(overviewCache&&overviewCache.day===today&&overviewCache.expires>Date.now())return overviewCache.value;
 const value=fetchOverview(today,yesterday).catch(error=>{overviewCache=undefined;throw error;});
 overviewCache={day:today,expires:Date.now()+30_000,value};return value;
}

export default async function OutreachPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  // Retired queue filters must not silently shrink the fixed reach-out list.
  if (params.status || params.priority || params.new || params.account) {
    const clean = new URLSearchParams();
    if (params.card) clean.set("card", params.card);
    if (params.list) clean.set("list", params.list);
    if (params.batch === '1' || params.batch === '2') clean.set("batch", params.batch);
    redirect(`/outreach${clean.size ? `?${clean}` : ""}`);
  }
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) {
    redirect("/setup");
  }
  const me = await requireUser();
  const requestedList = reachoutList(params.list, me.owner);
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  // Read saved drafts immediately. Repair runs in the research/refresh pipeline,
  // never as a prerequisite for rendering or changing worklist filters.
  const db = admin();
  // Populate the selected companies into the original editor once. Existing
  // drafts, sent records, and contact restrictions remain untouched.
  const existing = await db.from("cards").select("status,assigned_to,dismiss_reason,score_breakdown,signals!inner(hash),people(full_name),touches(sent_at,sent_by)").like("signals.hash", "operator-shortlist-20260923:%");
  if (existing.error) throw existing.error;
  const progress = batchProgress(requestedList.owner, (existing.data ?? []).map(row => ({
    domain: (row.signals as unknown as { hash: string }).hash.split(":")[1],
    owner: row.assigned_to,
    status: row.status,
    contacted: (row.touches ?? []).some(touch => touch.sent_at && touch.sent_by === requestedList.owner),
  })));
  const selectedList = reachoutList(params.list, me.owner, selectedBatch(params.batch, progress.sequence));
  const curatedDrafts = selectedList.drafts;
  const curatedDomains = curatedDrafts.map(row => row.domain);
  const prepared = new Set((existing.data ?? []).filter(row => {
    const hash = (row.signals as unknown as { hash: string }).hash;
    const person = row.people as unknown as { full_name: string } | null;
    return !wasAutomaticallyArchived(row) && Boolean(recipientResearch(hash.split(":")[1], person?.full_name));
  }).map(row => (row.signals as unknown as { hash: string }).hash));
  const missing = curatedDomains.filter(domain => !prepared.has(`operator-shortlist-20260923:${domain}`));
  for (let start = 0; start < missing.length; start += 5) {
    const results = await Promise.all(missing.slice(start, start + 5).map(domain => preparePriorityDraft(domain, me, db)));
    for (const result of results) {
      if (!result.ok && result.status !== 409) throw new Error((await result.json()).error);
    }
  }
  // Backfill newly researched addresses for existing contacts as well as new cards.
  // Never change verified, invalid, opted-out, or manually supplied addresses.
  const recipients = await db.from("people").select("id,full_name,email,email_status,email_source,do_not_contact,accounts!inner(domain)").in("accounts.domain", curatedDomains);
  if (recipients.error) throw recipients.error;
  for (let start = 0; start < (recipients.data ?? []).length; start += 5) {
    await Promise.all((recipients.data ?? []).slice(start, start + 5).map(async person => {
      const account = person.accounts as unknown as { domain: string };
      const patch = publishedEmailPatch(account.domain, person.full_name, person);
      if (!Object.keys(patch).length || (person.email === patch.email && person.email_source === patch.email_source && person.email_status === patch.email_status)) return;
      const result = await db.from("people").update(patch).eq("id", person.id);
      if (result.error) throw result.error;
    }));
  }
  const sender = await senderProfile(db, selectedList.owner);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = daysAgoIso(1);

  // An unactioned card must never disappear because a scheduled job failed:
  // query by status and score, and use surfaced_on only as the "new today" badge (F13).
  // signals!inner + the operating_need filter: a card whose signal never named
  // the work the company needs done was built under the old rules and is not a decision.
  const query = db
    .from("cards")
    .select("*,accounts!inner(*),people(*),signals!inner(*)")
    // This is the complete selected list, including sent records.
    // It is not the old unfinished-work queue.
    .in("accounts.domain", curatedDomains)
    .like("signals.hash", "operator-shortlist-20260923:%")
    .order("score", { ascending: false });


  if (selectedList.owner) query.eq("assigned_to", selectedList.owner);

  const [
    { data: cardRows, error },
    { data: gmailRows },
    [
    { count: activeAccounts },
    { count: researchedAccounts },
    coverage,
    { count: openCards },
    { count: newToday },
    { count: awaitingReply },
    { data: recentSignalRows },
    lastRun,
    lastSweep,
    { count: careersChecked },
    { count: careersNone },
    { count: newRoles },
    { count: closedRoles },
    { count: newPosts },
    { count: newPeople },
    { count: changedCompanies },
    openRunRow,
    lastFinishedRow,
    { count: unscannedOutreach },
    { count: listedOutreach },
    { count: totalPosts },
    ],
  ] = await Promise.all([
    query,
    db.from("gmail_connections").select("owner,email"),
    loadOverview(today,yesterday),
  ]);
  if (error) throw error;
  const hiringCompanies = coverage.hiringCompanies;
  const targetRolesOpen = coverage.targetRolesOpen;

  const recentSignals = (recentSignalRows ?? []).map((signal) => {
    const raw = (signal.raw ?? {}) as {
      post?: { text?: string; author_name?: string; author_title?: string; published_at?: string };
      source?: { excerpt?: string; author_name?: string | null; published_at?: string };
    };
    const account = signal.accounts as unknown as { name: string; domain: string };
    const person = signal.people as unknown as { full_name: string; title: string } | null;
    return {
      company: account.name,
      domain: account.domain,
      type: signal.type,
      summary: signal.summary,
      sourceUrl: signal.source_url,
      observedAt: signal.observed_at,
      authorName: raw.post?.author_name ?? raw.source?.author_name ?? person?.full_name ?? null,
      authorTitle: raw.post?.author_title ?? person?.title ?? null,
      sourceText: raw.post?.text ?? raw.source?.excerpt ?? signal.summary,
      publishedAt: raw.post?.published_at ?? raw.source?.published_at ?? signal.observed_at,
      isPost: Boolean(raw.post),
    };
  });

  const signalAccounts = coverage.signalAccounts;
  const active = activeAccounts ?? 0;
  const researched = researchedAccounts ?? 0;
  const batchSize = nightlyBatchSize();
  // Seat → the name that seat sends as, so the worklist says "Suuchi Ramesh" rather than the internal slug
  // "jenna". History already did this; the worklist and the dossier were still showing the raw seat, which
  // is the kind of thing a person notices immediately when it is their own prospect list.
  const { data: seatRows } = await admin().from("sender_profiles").select("owner,from_name");
  const seatNames: Record<string, string> = {};
  for (const row of (seatRows ?? []) as Array<{ owner: string; from_name: string | null }>) {
    if (row.from_name?.trim()) seatNames[row.owner] = row.from_name.trim();
  }

  const context: DeskContext = {
    today,
    seatNames,
    targetTotal: activeTargetAccounts.length,
    activeAccounts: active,
    listedCompanies: listedOutreach ?? 0,
    totalRoles: targetRolesOpen,
    totalPosts: totalPosts ?? 0,
    coverage: {
      neverResearched: Math.max(0, active - researched),
      researched,
      checkedNoSignal: Math.max(0, researched - signalAccounts),
      signalsFound: signalAccounts,
      dossiersReady: openCards ?? 0,
      failedLastRun: lastRun?.counts.error ?? 0,
      careersChecked: careersChecked ?? 0,
      careersNotFound: careersNone ?? 0,
      hiringCompanies,
      targetRolesOpen,
    },
    queue: { open: openCards ?? 0, newToday: newToday ?? 0, awaitingReply: awaitingReply ?? 0 },
    changes: { companies: changedCompanies ?? 0, newRoles: newRoles ?? 0, closedRoles: closedRoles ?? 0, newPosts: newPosts ?? 0, newPeople: newPeople ?? 0 },
    recentSignals,
    lastRun,
    lastSweep,
    sweepBatchSize: sweepAccountLimit(),
    populate: populateConfig(),
    populateSweep: populateSweepConfig(),
    batchSize,
    projectedMaxCostUsd: Number((batchSize * maxCostPerAccountUsd()).toFixed(2)),
  };
  // "New" means the card was created today; anything older that is still open was not actioned on an earlier
  // day and has rolled forward, so it is marked as carried over rather than re-badged "new" every morning.
  const dayStart = `${today}T00:00:00`;
  const workingCutoff = new Date().getTime() - 30 * 60 * 1000;
  const surfaced = (cardRows ?? []).sort((a, b) => curatedDomains.indexOf(a.accounts.domain) - curatedDomains.indexOf(b.accounts.domain))
    // Never surface a card whose contact is a marketing phrase, not a real person.
    .filter((card) => { const person = card.people as { full_name?: string } | null; return person?.full_name ? isLikelyPersonName(person.full_name) && Boolean(recipientResearch(card.accounts.domain, person.full_name)) : false; });

  // The follow-up sequence for each surfaced card, so the desk can show it inline under the draft.
  const followupsByCard = new Map<string, Array<{ id: string; step: number; channel: string; title: string; detail: string; subject: string | null; body: string; status: string; scheduledAt: string; forPerson: string; forPersonId: string }>>();
  const cardIds = surfaced.map((card) => card.id as string);
  if (cardIds.length) {
    // Carry the person the cadence is for. A cadence belongs to one contact, not to the whole company, and
    // without their name the desk showed "Hi Asif," under whichever colleague happened to be selected.
    const { data: cads } = await db.from("cadences").select("id,card_id,person_id,people(full_name)").in("card_id", cardIds).eq("status", "active");
    const cadToCard = new Map((cads ?? []).map((row) => [row.id as string, {
      cardId: row.card_id as string,
      personId: (row.person_id as string) ?? "",
      personName: ((row.people as unknown as { full_name?: string } | null)?.full_name) ?? "",
    }]));
    const cadIds = [...cadToCard.keys()];
    if (cadIds.length) {
      const { data: steps } = await db.from("cadence_steps").select("id,step_number,channel,title,detail,subject,body,status,scheduled_at,cadence_id").eq("kind", "review").in("cadence_id", cadIds).order("step_number");
      for (const step of steps ?? []) {
        const owner = cadToCard.get(step.cadence_id as string);
        if (!owner) continue;
        const list = followupsByCard.get(owner.cardId) ?? [];
        list.push({ id: step.id as string, step: step.step_number as number, channel: step.channel as string, title: step.title as string, detail: step.detail as string, subject: (step.subject as string | null) ?? null, body: (step.body as string | null) ?? "", status: step.status as string, scheduledAt: step.scheduled_at as string, forPerson: owner.personName, forPersonId: owner.personId });
        followupsByCard.set(owner.cardId, list);
      }
    }
  }

  // Every open card in the fixed, curated list belongs in the worklist.
  const cards = surfaced.map((card) => {
    const created = (card.created_at as string | null) ?? "";
    const workingAt = card.working_at as string | null;
    return { ...card, isNew: created >= dayStart, carriedOver: Boolean(created) && created < dayStart, working: Boolean(workingAt && Date.parse(workingAt) > workingCutoff), onWorklist: true, followups: followupsByCard.get(card.id as string) ?? [] };
  });

  // The app runs itself: opening the desk starts or continues the scan and shows progress, so nobody has to drive the Runs page.
  const openRun = openRunRow.data ? await loadRunSummary(db, openRunRow.data.id as string) : null;
  const listed = listedOutreach ?? 0;
  const scan = <ScanControl
    listSize={listed}
    unscanned={unscannedOutreach ?? 0}
    firstPass={(careersChecked ?? 0) === 0 && researched === 0}
    openRun={openRun}
    lastFinishedAt={(lastFinishedRow.data?.finished_at as string | null) ?? null}
    pendingReachOuts={hiringCompanies > (openCards ?? 0)}
  />;

  return (
    <div className="shell">
      <Header />
      <nav aria-label="Reach-out lists" className="reachout-list-switcher">
        {[{ id: "josh", label: "Josh" }, { id: "suuchi", label: "Suuchi" }].map(list => (
          // Use document navigation for list switches. The first visit may prepare
          // records, and must not wait silently in a client-side transition.
          <a key={list.id} href={`/outreach?list=${list.id}${params.batch === '1' || params.batch === '2' ? `&batch=${params.batch}` : ''}`} aria-current={selectedList.id === list.id ? "page" : undefined}>
            {list.label}
          </a>
        ))}
      </nav>
      <nav aria-label="Company batches" className="reachout-list-switcher">
        {([1, 2] as const).map(sequence => <a key={sequence}
          href={reachoutList(selectedList.id, me.owner, sequence).href}
          aria-current={selectedList.sequence === sequence ? 'page' : undefined}>
          {sequence === 1 ? 'First 25' : 'Next 25'}
        </a>)}
      </nav>
      {me.role === "admin" && <RefreshDraftCopy revision={createHash("sha256").update(JSON.stringify(curatedDrafts)).digest("hex").slice(0, 16)} />}
      <Desk
        key={`${me.owner}:${selectedList.id}:${selectedList.sequence}`}
        batchSequence={selectedList.sequence}
        autoAdvanceBatch={params.batch !== '1' && params.batch !== '2'}
        listOwner={selectedList.owner}
        batchCompletedDomains={progress.completedDomains}
        listHref={selectedList.href}
        initialCards={cards}
        senderName={senderFirstName(sender) || (selectedList.owner === "josh" ? "Josh" : "Suuchi")}
        senderIsViewer={selectedList.owner === me.owner}
        senderGreeting={sender.greeting}
        senderFooterHtml={outreachFooterHtml(sender)}
        selectedId={params.card}
        gmailConnected={(gmailRows ?? []).some((row) => (row as { owner: string }).owner === me.owner)}
        context={context}
        scan={scan}
        tools={me.role === "admin" ? <ToolDrawer label="Draft tools" title="Draft tools"><RewriteDrafts /></ToolDrawer> : null}
      />
    </div>
  );
}
