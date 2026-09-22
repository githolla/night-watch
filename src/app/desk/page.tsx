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
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { admin } from "@/lib/supabase/admin";
import { deskCoverage } from "@/lib/desk-coverage";
import { activeTargetAccounts } from "@/lib/target-accounts";
import { daysAgoIso } from "@/lib/time";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { card?: string; status?: string; priority?: string; new?: string; source?: string; account?: string };

/** Card statuses a salesperson still has to decide on. */
const OPEN_STATUSES = ["new", "approved", "edited"];

export default async function DeskPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) {
    redirect("/setup");
  }
  const me = await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  // Read saved drafts immediately. Repair runs in the research/refresh pipeline,
  // never as a prerequisite for rendering or changing worklist filters.
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = daysAgoIso(1);

  // An unactioned card must never disappear because a scheduled job failed:
  // query by status and score, and use surfaced_on only as the "new today" badge (F13).
  // signals!inner + the operating_need filter: a card whose signal never named
  // the work the company needs done was built under the old rules and is not a decision.
  let query = db
    .from("cards")
    .select("*,accounts!inner(*),people(*),signals!inner(*)")
    .not("signals.raw->>operating_need", "is", null)
    // The desk is the reach-out list only.
    .eq("accounts.outreach", true)
    .order("score", { ascending: false });
  query = params.status ? query.eq("status", params.status) : query.in("status", OPEN_STATUSES);
  if (params.priority === "high") query = query.gte("score", PRIORITY_THRESHOLD);
  if (params.new === "today") query = query.eq("surfaced_on", today);
  if (params.account) query = query.eq("accounts.domain", params.account.toLowerCase());

  const [
    { data: cardRows, error },
    { data: gmailRows },
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
  ] = await Promise.all([
    query,
    db.from("gmail_connections").select("owner,email"),
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
  const surfaced = (cardRows ?? [])
    // Never surface a card whose contact is a marketing phrase, not a real person.
    .filter((card) => { const person = card.people as { full_name?: string } | null; return person?.full_name ? isLikelyPersonName(person.full_name) : false; });

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

  // Stable daily worklist: at the first desk open each day, lock in the top ~25 open prospects. Membership
  // then stays fixed all day (no reshuffle, nothing new bubbling up), so re-entering is easy. Graceful if the
  // worklist_on column (migration 0023) isn't applied yet.
  const DAILY_WORKLIST = 25;
  try {
    const stampedToday = surfaced.some((card) => (card.worklist_on as string | null) === today);
    if (!stampedToday) {
      const alreadyOn = surfaced.filter((card) => card.worklist_on).length;
      const toAdd = surfaced.filter((card) => !card.worklist_on).slice(0, Math.max(0, DAILY_WORKLIST - alreadyOn)).map((card) => card.id as string);
      if (toAdd.length) {
        await db.from("cards").update({ worklist_on: today }).in("id", toAdd);
        const added = new Set(toAdd);
        for (const card of surfaced) if (added.has(card.id as string)) (card as { worklist_on?: string | null }).worklist_on = today;
      }
    }
  } catch { /* column not migrated yet — the desk falls back to the score-ordered list */ }

  const cards = surfaced.map((card) => {
    const created = (card.created_at as string | null) ?? "";
    const workingAt = card.working_at as string | null;
    return { ...card, isNew: created >= dayStart, carriedOver: Boolean(created) && created < dayStart, working: Boolean(workingAt && Date.parse(workingAt) > workingCutoff), onWorklist: Boolean(card.worklist_on), followups: followupsByCard.get(card.id as string) ?? [] };
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
      {me.role === "admin" && <RefreshDraftCopy />}
      <Desk
        initialCards={cards}
        selectedId={params.card}
        gmailConnected={(gmailRows ?? []).some((row) => (row as { owner: string }).owner === me.owner)}
        context={context}
        scan={scan}
        tools={me.role === "admin" ? <ToolDrawer label="Draft tools" title="Draft tools"><RewriteDrafts /></ToolDrawer> : null}
      />
    </div>
  );
}
