import { Desk, type DeskContext } from "@/components/Desk";
import { ScanControl } from "@/components/ScanControl";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { maxCostPerAccountUsd, nightlyBatchSize, populateConfig, populateSweepConfig, sweepAccountLimit } from "@/lib/run-config";
import { latestRunSummary, loadRunSummary, SWEEP_SOURCES } from "@/lib/run-status";
import { isLikelyPersonName } from "@/lib/pipeline";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { admin } from "@/lib/supabase/admin";
import { fetchAll } from "@/lib/supabase/fetch-all";
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
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = daysAgoIso(1);
  const owner = "josh" as const;

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
    { data: gmail },
    { count: activeAccounts },
    { count: researchedAccounts },
    signalAccountRows,
    { count: openCards },
    { count: newToday },
    { count: awaitingReply },
    { data: recentSignalRows },
    lastRun,
    lastSweep,
    { count: careersChecked },
    { count: careersNone },
    hiringRows,
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
    db.from("gmail_connections").select("id").eq("owner", owner).maybeSingle(),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example").not("last_scouted_at", "is", null),
    fetchAll<{ account_id: string }>((from, to) => db.from("signals").select("account_id").range(from, to)),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES).eq("surfaced_on", today),
    db.from("cards").select("*", { count: "exact", head: true }).eq("status", "sent"),
    db.from("signals").select("type,summary,source_url,observed_at,raw,accounts(name,domain),people(full_name,title)").order("found_at", { ascending: false }).limit(8),
    latestRunSummary(db),
    latestRunSummary(db, SWEEP_SOURCES),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("careers_checked_at", "is", null),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("careers_status", "none"),
    fetchAll<{ account_id: string }>((from, to) => db.from("job_postings").select("account_id").eq("active", true).not("family", "is", null).range(from, to)),
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
  const hiringCompanies = new Set(hiringRows.map((row) => row.account_id as string)).size;
  const targetRolesOpen = hiringRows.length;

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

  const signalAccounts = new Set(signalAccountRows.map((row) => row.account_id as string)).size;
  const active = activeAccounts ?? 0;
  const researched = researchedAccounts ?? 0;
  const batchSize = nightlyBatchSize();
  const context: DeskContext = {
    today,
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
  const cards = (cardRows ?? [])
    // Never surface a card whose contact is a marketing phrase, not a real person.
    .filter((card) => { const person = card.people as { full_name?: string } | null; return person?.full_name ? isLikelyPersonName(person.full_name) : false; })
    .map((card) => {
      const created = (card.created_at as string | null) ?? "";
      const workingAt = card.working_at as string | null;
      return { ...card, isNew: created >= dayStart, carriedOver: Boolean(created) && created < dayStart, working: Boolean(workingAt && Date.parse(workingAt) > workingCutoff) };
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
      <Desk initialCards={cards} selectedId={params.card} gmailConnected={Boolean(gmail)} context={context} scan={scan} />
    </div>
  );
}
