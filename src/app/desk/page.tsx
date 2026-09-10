import { Desk, type DeskContext } from "@/components/Desk";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { maxCostPerAccountUsd, nightlyBatchSize, populateConfig, sweepAccountLimit } from "@/lib/run-config";
import { latestRunSummary, SWEEP_SOURCES } from "@/lib/run-status";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = { card?: string; status?: string; priority?: string; new?: string; source?: string };

/** Card statuses a salesperson still has to decide on. */
const OPEN_STATUSES = ["new", "approved", "edited"];

export default async function DeskPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) {
    redirect("/setup");
  }
  const user = await requireUser();
  const db = admin();
  const today = new Date().toISOString().slice(0, 10);
  const owner = user.email?.startsWith("jenna") ? "jenna" : "josh";

  // An unactioned card must never disappear because a scheduled job failed:
  // query by status and score, and use surfaced_on only as the "new today" badge (F13).
  // signals!inner + the operating_need filter: a card whose signal never named
  // the work the company needs done was built under the old rules and is not a decision.
  let query = db
    .from("cards")
    .select("*,accounts(*),people(*),signals!inner(*)")
    .not("signals.raw->>operating_need", "is", null)
    .order("score", { ascending: false });
  query = params.status ? query.eq("status", params.status) : query.in("status", OPEN_STATUSES);
  if (params.priority === "high") query = query.gte("score", PRIORITY_THRESHOLD);
  if (params.new === "today") query = query.eq("surfaced_on", today);

  const [
    { data: cardRows, error },
    { data: gmail },
    { count: activeAccounts },
    { count: researchedAccounts },
    { data: signalAccountRows },
    { count: openCards },
    { count: newToday },
    { count: awaitingReply },
    { data: recentSignalRows },
    lastRun,
    lastSweep,
    { count: careersChecked },
    { count: careersNone },
    { data: hiringRows },
  ] = await Promise.all([
    query,
    db.from("gmail_connections").select("id").eq("owner", owner).maybeSingle(),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example").not("last_scouted_at", "is", null),
    db.from("signals").select("account_id").limit(5000),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES),
    db.from("cards").select("id,signals!inner(raw)", { count: "exact", head: true }).not("signals.raw->>operating_need", "is", null).in("status", OPEN_STATUSES).eq("surfaced_on", today),
    db.from("cards").select("*", { count: "exact", head: true }).eq("status", "sent"),
    db.from("signals").select("type,summary,source_url,observed_at,raw,accounts(name,domain),people(full_name,title)").order("found_at", { ascending: false }).limit(8),
    latestRunSummary(db),
    latestRunSummary(db, SWEEP_SOURCES),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("careers_checked_at", "is", null),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").eq("careers_status", "none"),
    db.from("job_postings").select("account_id").eq("active", true).not("family", "is", null).limit(5000),
  ]);
  if (error) throw error;
  const hiringCompanies = new Set((hiringRows ?? []).map((row) => row.account_id as string)).size;
  const targetRolesOpen = hiringRows?.length ?? 0;

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

  const signalAccounts = new Set((signalAccountRows ?? []).map((row) => row.account_id as string)).size;
  const active = activeAccounts ?? 0;
  const researched = researchedAccounts ?? 0;
  const batchSize = nightlyBatchSize();
  const context: DeskContext = {
    today,
    targetTotal: targetAccounts.length,
    activeAccounts: active,
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
    recentSignals,
    lastRun,
    lastSweep,
    sweepBatchSize: sweepAccountLimit(),
    populate: populateConfig(),
    batchSize,
    projectedMaxCostUsd: Number((batchSize * maxCostPerAccountUsd()).toFixed(2)),
  };
  const cards = (cardRows ?? []).map((card) => ({ ...card, isNew: card.surfaced_on === today }));

  return (
    <div className="shell">
      <Header />
      <Desk initialCards={cards} selectedId={params.card} gmailConnected={Boolean(gmail)} context={context} />
    </div>
  );
}
