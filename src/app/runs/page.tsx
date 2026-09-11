import Link from "next/link";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { RunPanel } from "@/components/RunPanel";
import { requireUser } from "@/lib/auth";
import { maxCostPerAccountUsd, nightlyBatchSize, populateConfig, populateSweepConfig, sweepAccountLimit } from "@/lib/run-config";
import { latestRunSummary, SWEEP_SOURCES } from "@/lib/run-status";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { targetAccounts } from "@/lib/target-accounts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** One place to start, continue, stop and watch every run. The baseline pass is the primary action here. */
export default async function RunsPage() {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const pending = await pendingMigrations(db);
  if (pending.length) return <MigrationRequired pending={pending} />;

  const [lastRun, lastSweep, { count: active }, { count: careersChecked }, { count: researched }, { count: openRoles }, { count: posts }, { count: people }] = await Promise.all([
    latestRunSummary(db),
    latestRunSummary(db, SWEEP_SOURCES),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("domain", "like", "%.example"),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("careers_checked_at", "is", null),
    db.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active").not("last_scouted_at", "is", null),
    db.from("job_postings").select("*", { count: "exact", head: true }).eq("active", true).not("family", "is", null),
    db.from("public_posts").select("*", { count: "exact", head: true }),
    db.from("people").select("*", { count: "exact", head: true }),
  ]);
  const total = active ?? 0;
  const synced = total === targetAccounts.length;
  const populate = populateConfig();
  const populateSweep = populateSweepConfig();
  const batchSize = nightlyBatchSize();

  return <div className="shell">
    <Header />
    <main className="targets-page">
      <section className="targets-head">
        <div><span className="eyebrow">Runs</span><h1>Build the baseline once. Night Watch keeps it current.</h1><p>Two passes, in order. The extensive sweep reads every careers page, job board and sitemap, searches for AI posts by people at each company, and enriches contacts. The research pass then puts a model on every company, hiring companies first. After that the hourly sweep and the nightly research are the updates.</p></div>
        <div className="targets-head-count"><span>BASELINE SO FAR</span><strong>{(careersChecked ?? 0).toLocaleString()} / {total.toLocaleString()}</strong><small>careers pages read · {(researched ?? 0).toLocaleString()} researched · {(openRoles ?? 0).toLocaleString()} target roles · {(posts ?? 0).toLocaleString()} posts · {(people ?? 0).toLocaleString()} people</small></div>
      </section>

      {!synced && <p className="notice error">The target list is not fully synced ({total.toLocaleString()} of {targetAccounts.length.toLocaleString()} active). <Link href="/targets">Sync it on the Accounts page</Link> before running the baseline.</p>}

      <section className="run-kind">
        <header><span className="eyebrow">Step 1 · Extensive sweep</span><h2>Read everything, for every company</h2><p>Careers pages and job boards read directly; a job-board search and an AI-posts search per company on {populateSweep.model} with {populateSweep.searches} searches each; contacts for every company. Pauses at ${populateSweep.budgetUsd.toFixed(0)} per press and continues on the next. The button below is the baseline; the smaller one is what the hourly cron does.</p></header>
        <RunPanel
          kind="sweep"
          endpoint="/api/sweep/run"
          initialRun={lastSweep}
          batchSize={sweepAccountLimit()}
          projectedMaxCostUsd={0}
          disabled={!synced}
          startLabel={`Run the extensive sweep of all ${total.toLocaleString()} companies`}
          startBody={{ all: true, populate: true }}
          startConfirm={`Extensive first pass over all ${total.toLocaleString()} companies. This is the thorough pass, not the cheap one: it pauses at $${populateSweep.budgetUsd.toFixed(0)} of measured spend per press and continues when pressed again.`}
          extraActions={[{ label: `Sweep the next ${sweepAccountLimit()} (hourly default)`, body: { limit: sweepAccountLimit() } }]}
        />
      </section>

      <section className="run-kind">
        <header><span className="eyebrow">Step 2 · Research</span><h2>Put the model on every company, hiring companies first</h2><p>Up to {populate.accountLimit.toLocaleString()} companies with {populate.maxSearches} web searches each, ignoring the 7-day cooldown, looking for managers asking for help, AI posts, new mandates and growth events. Pauses at ${populate.budgetUsd.toFixed(0)} per press. The smaller button is what the nightly cron does: {batchSize} companies, ≈ ${(batchSize * maxCostPerAccountUsd()).toFixed(2)}.</p></header>
        <RunPanel
          initialRun={lastRun}
          batchSize={batchSize}
          projectedMaxCostUsd={Number((batchSize * maxCostPerAccountUsd()).toFixed(2))}
          disabled={!synced}
          startLabel={`Research every company, ${populate.maxSearches} searches each`}
          startBody={{ populate: true }}
          startConfirm={`Research up to ${populate.accountLimit.toLocaleString()} companies with ${populate.maxSearches} searches each on the research model, hiring companies first. Pauses at $${populate.budgetUsd.toFixed(0)} per press and continues when pressed again.`}
          extraActions={[{ label: `Research the next ${batchSize} (nightly default)`, body: { limit: batchSize } }]}
        />
      </section>

      <p className="coverage-note">Where the data lands: <Link href="/roles">Roles</Link>, <Link href="/posts">Posts</Link>, <Link href="/people">People</Link>, and <Link href="/targets">Accounts</Link> sorted by intelligence score. Dossiers appear on the <Link href="/desk">Desk</Link>.</p>
    </main>
  </div>;
}
