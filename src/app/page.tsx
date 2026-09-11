import { Dashboard, type DashboardData } from "@/components/Dashboard";
import { MigrationRequired } from "@/components/MigrationRequired";
import { pendingMigrations } from "@/lib/schema-check";
import { Header } from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { admin } from "@/lib/supabase/admin";
import { PRIORITY_THRESHOLD, CARD_THRESHOLD } from "@/lib/scoring";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Overview() {
  if (
    !(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) ||
    !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)
  )
    redirect("/setup");
  await requireUser();
  {
    const pending = await pendingMigrations(admin());
    if (pending.length) return <MigrationRequired pending={pending} />;
  }
  const db = admin(),
    now = new Date(),
    today = now.toISOString().slice(0, 10),
    cutoff = new Date(now.getTime() - 48 * 3600_000).toISOString();
  const [{ data: cards }, { data: signals }, { data: run }, { data: touches }] = await Promise.all([
    db
      .from("cards")
      .select("id,score,status,channel,why_now,assigned_to,surfaced_on,accounts(name),people(full_name,title),signals!inner(type,summary,source_url)")
      .not("signals.raw->>operating_need", "is", null)
      .in("status", ["new", "approved", "edited"])
      .order("score", { ascending: false })
      .limit(10),
    db
      .from("signals")
      .select("id,type,summary,source_url,found_at,accounts(name),cards(id)")
      .gte("found_at", cutoff)
      .order("found_at", { ascending: false })
      .limit(50),
    db.from("runs").select("*").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("touches").select("sent_at,reply_classification,sent_by,cards(accounts(name))").order("created_at", { ascending: false }).limit(10),
  ]);
  const priority = (cards ?? []) as unknown as Parameters<typeof Dashboard>[0]["cards"],
    positiveReplies = (touches ?? []).filter((t) => t.reply_classification === "positive").length,
    sourceCount = { jobs: 0, posts: 0, news: 0, events: 0 };
  for (const signal of signals ?? []) {
    if (["job_post", "job_cluster"].includes(signal.type)) sourceCount.jobs++;
    else if (signal.type === "exec_post") sourceCount.posts++;
    else if (signal.type === "event") sourceCount.events++;
    else sourceCount.news++;
  }
  const total = Math.max(1, signals?.length ?? 0),
    finish = run?.finished_at ? new Date(run.finished_at) : null,
    start = run?.started_at ? new Date(run.started_at) : null,
    duration = finish && start ? `${Math.round((finish.getTime() - start.getTime()) / 60000)}m` : "—";
  const data: DashboardData = {
    metrics: {
      newSignals: signals?.length ?? 0,
      surfacedCards: (cards ?? []).filter((c) => c.surfaced_on === today).length,
      highPriority: (cards ?? []).filter((c) => c.score >= PRIORITY_THRESHOLD).length,
      positiveReplies,
    },
    run: {
      status: run?.finished_at ? "Complete" : "Running",
      finishedAt: finish ? finish.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—",
      accounts: run?.accounts_scouted ?? 0,
      signals: run?.signals_new ?? 0,
      cards: run?.cards_created ?? 0,
      cost: Number(run?.cost_usd ?? 0),
      duration,
    },
    sources: [
      {
        name: "Careers",
        count: sourceCount.jobs,
        share: Math.round((sourceCount.jobs / total) * 100),
        detail: "Job posts and clusters",
        filter: "jobs",
      },
      {
        name: "Executive posts",
        count: sourceCount.posts,
        share: Math.round((sourceCount.posts / total) * 100),
        detail: "Public leadership posts",
        filter: "posts",
      },
      {
        name: "Company news",
        count: sourceCount.news,
        share: Math.round((sourceCount.news / total) * 100),
        detail: "Leadership, funding and markets",
        filter: "news",
      },
      {
        name: "Events",
        count: sourceCount.events,
        share: Math.round((sourceCount.events / total) * 100),
        detail: "Reachable speakers",
        filter: "events",
      },
    ],
    pipeline: [
      { name: "Signals found", count: signals?.length ?? 0, note: "past 48 hours", href: "/?view=signals" },
      { name: "People matched", count: cards?.length ?? 0, note: "mapped signal owners", href: "/desk" },
      { name: "Above threshold", count: (cards ?? []).filter((c) => c.score >= CARD_THRESHOLD).length, note: `score ${CARD_THRESHOLD}+`, href: "/desk?status=new" },
      { name: "Surfaced today", count: (cards ?? []).filter((c) => c.surfaced_on === today).length, note: "new this morning", href: "/desk?new=today" },
      {
        name: "Approved",
        count: (cards ?? []).filter((c) => c.status === "approved").length,
        note: "ready for action",
        href: "/desk?status=approved",
      },
    ],
    recentSignals: (signals ?? [])
      .slice(0, 8)
      .map((s) => ({
        id: s.id,
        type: s.type.replaceAll("_", " "),
        account: (s.accounts as unknown as { name: string })?.name ?? "Unknown",
        summary: s.summary,
        age: relativeAge(s.found_at, now.getTime()),
        source: hostnameOf(s.source_url),
        sourceUrl: s.source_url,
        cardId: (s.cards as unknown as Array<{ id: string }>)?.[0]?.id ?? null,
        isNew: true,
      })),
    accounts: priority
      .slice(0, 5)
      .map((c) => ({
        name: c.accounts.name,
        signalCount: 1,
        topSignal: c.signals.type?.replaceAll("_", " ") ?? "Signal",
        score: c.score,
        owner: c.assigned_to,
      })),
    activity: (touches ?? [])
      .slice(0, 5)
      .map((t) => ({
        time: new Date(t.sent_at ?? now.toISOString()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        label: t.reply_classification === "positive" ? "Positive reply" : "Outbound activity",
        detail: `${t.sent_by} · ${(t.cards as unknown as { accounts: { name: string } })?.accounts?.name ?? "Account"}`,
      })),
  };
  return (
    <div className="shell">
      <Header />
      <Dashboard data={data} cards={priority} />
    </div>
  );
}
function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "public source";
  }
}
function relativeAge(value: string, now: number) {
  const minutes = Math.max(1, Math.round((now - new Date(value).getTime()) / 60000));
  return minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.round(minutes / 60)}h` : `${Math.round(minutes / 1440)}d`;
}
