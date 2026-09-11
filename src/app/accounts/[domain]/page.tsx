import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { OutreachForm } from "@/components/OutreachForm";
import { RunPanel } from "@/components/RunPanel";
import { requireUser } from "@/lib/auth";
import { FAMILY_LABEL, type JobFamily } from "@/lib/job-sweep/classify";
import { isOutreachStage, STAGE_LABEL, type OutreachStage } from "@/lib/outreach";
import { maxCostPerAccountUsd } from "@/lib/run-config";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { TIER_DEFINITION, TIER_LABEL, targetAccountByDomain, type TargetTier } from "@/lib/target-accounts";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

type Posting = { id: string; title: string; url: string; location: string | null; department: string | null; family: string | null; source: string | null; posted_at: string | null; first_seen_at: string; active: boolean };
type Post = { id: string; author_name: string; author_title: string; url: string; platform: string; topic: string; excerpt: string; posted_at: string | null; created_at: string };
type Person = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; linkedin_url: string | null; source: string; enriched_at: string | null };
type SignalRow = { id: string; type: string; summary: string; source_url: string; observed_at: string; found_at: string; raw: { operating_need?: string; evidence_kind?: string } | null; people: { full_name: string; title: string } | null };
type CardRow = { id: string; status: string; score: number; channel: string; why_now: string; brief: string; assigned_to: string; created_at: string; people: { full_name: string; title: string } | null };
type TouchRow = { id: string; channel: string; sent_at: string | null; sent_by: string; reply_at: string | null; reply_classification: string; card_id: string };
type HistoryRow = { status: string; note: string | null; error_code: string | null; error_message: string | null; signals_kept: number | null; cards_created: number | null; started_at: string | null; finished_at: string | null; runs: { source: string; started_at: string } | null };

const RUN_LABEL: Record<string, string> = { scheduled: "Nightly research", manual: "Research", sweep: "Hourly sweep", sweep_manual: "Sweep" };
const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", ok: "Signal found", no_signal: "No signal", error: "Failed", cancelled: "Stopped" };

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

/** Everything on file for one company, and the hand-kept reach-out state. */
export default async function AccountPage({ params }: { params: Promise<{ domain: string }> }) {
  if (!(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)) redirect("/setup");
  await requireUser();
  const db = admin();
  const pending = await pendingMigrations(db);
  if (pending.length) return <MigrationRequired pending={pending} />;
  const { domain: rawDomain } = await params;
  const domain = decodeURIComponent(rawDomain).toLowerCase();
  const target = targetAccountByDomain.get(domain);
  const { data: liveRow } = await db.from("accounts").select("*").eq("domain", domain).maybeSingle();
  const live = liveRow as Account | null;
  if (!target && !live) notFound();

  const name = live?.name ?? target?.name ?? domain;
  const tier = (live?.tier ?? target?.tier ?? null) as TargetTier | null;
  const outreach = live?.outreach ?? target?.outreach ?? false;
  const stage: OutreachStage = isOutreachStage(live?.outreach_stage) ? live.outreach_stage : "untouched";
  const intel = (live?.intel_breakdown ?? {}) as { roles?: number; posts?: number; contacts?: number; cards?: number };

  const [postings, posts, people, signals, cards, history, ownerRows] = live ? await Promise.all([
    db.from("job_postings").select("id,title,url,location,department,family,source,posted_at,first_seen_at,active").eq("account_id", live.id).order("active", { ascending: false }).order("family", { ascending: true, nullsFirst: false }).order("first_seen_at", { ascending: false }).limit(80).then((result) => (result.data ?? []) as Posting[]),
    db.from("public_posts").select("id,author_name,author_title,url,platform,topic,excerpt,posted_at,created_at").eq("account_id", live.id).order("posted_at", { ascending: false, nullsFirst: false }).limit(30).then((result) => (result.data ?? []) as Post[]),
    db.from("people").select("id,full_name,title,level,email,email_status,linkedin_url,source,enriched_at").eq("account_id", live.id).eq("do_not_contact", false).order("level").order("full_name").limit(60).then((result) => (result.data ?? []) as Person[]),
    db.from("signals").select("id,type,summary,source_url,observed_at,found_at,raw,people(full_name,title)").eq("account_id", live.id).order("observed_at", { ascending: false }).limit(30).then((result) => (result.data ?? []) as unknown as SignalRow[]),
    db.from("cards").select("id,status,score,channel,why_now,brief,assigned_to,created_at,people(full_name,title)").eq("account_id", live.id).order("created_at", { ascending: false }).limit(20).then((result) => (result.data ?? []) as unknown as CardRow[]),
    db.from("run_accounts").select("status,note,error_code,error_message,signals_kept,cards_created,started_at,finished_at,runs(source,started_at)").eq("account_id", live.id).order("created_at", { ascending: false }).limit(12).then((result) => (result.data ?? []) as unknown as HistoryRow[]),
    db.from("accounts").select("outreach_owner").not("outreach_owner", "is", null).limit(200).then((result) => (result.data ?? []) as Array<{ outreach_owner: string }>),
  ]) : [[], [], [], [], [], [], []] as [Posting[], Post[], Person[], SignalRow[], CardRow[], HistoryRow[], Array<{ outreach_owner: string }>];
  const touches = cards.length ? ((await db.from("touches").select("id,channel,sent_at,sent_by,reply_at,reply_classification,card_id").in("card_id", cards.map((card) => card.id)).order("created_at", { ascending: false })).data ?? []) as TouchRow[] : [];
  const owners = [...new Set(["Josh", "Jenna", ...ownerRows.map((row) => row.outreach_owner)])].sort((a, b) => a.localeCompare(b));
  const targetPostings = postings.filter((posting) => posting.active && posting.family);
  const otherPostings = postings.filter((posting) => !(posting.active && posting.family));
  const openCards = cards.filter((card) => ["new", "approved", "edited", "snoozed"].includes(card.status));

  return <div className="shell">
    <Header />
    <main className="targets-page account-page">
      <p className="account-crumbs"><Link href="/outreach">Reach-out list</Link> / <Link href="/targets">Accounts</Link> / {name}</p>
      <section className="targets-head has-hero">
        <div>
          <span className="eyebrow">{tier ? TIER_LABEL[tier] : "Not on the target file"}{live?.outreach_manual === true ? " · put on the list by hand" : live?.outreach_manual === false ? " · taken off by hand" : ""}</span>
          <h1>{name}</h1>
          <p>
            <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain} ↗</a>
            {target && <> · {target.vertical}{target.subSegment ? ` · ${target.subSegment}` : ""} · {target.hqCity}, {target.hqState} · {target.ownership}{target.peSponsor ? ` (${target.peSponsor})` : ""} · ${target.revenueBand}{target.revenueEstimateUsdM ? ` (≈ $${target.revenueEstimateUsdM.toLocaleString()}M)` : ""}{target.employees ? ` · ${target.employees.toLocaleString()} employees` : ""}</>}
          </p>
          {target && <dl className="account-facts">
            {target.ceo && <div><dt>CEO</dt><dd>{target.ceo}</dd></div>}
            <div><dt>Likely buyers</dt><dd>{target.targetTitles.join(" · ") || "—"}</dd></div>
            {target.aiSignal && <div><dt>AI signal on file</dt><dd>{target.aiSignal}</dd></div>}
            {target.notes && <div><dt>File notes</dt><dd>{target.notes}</dd></div>}
            {target.dropReason && <div><dt>Why the cut removed it</dt><dd>{target.dropReason}</dd></div>}
            {tier && <div><dt>Tier rule</dt><dd>{TIER_DEFINITION[tier]}</dd></div>}
            {target.sourceUrl && <div><dt>Source</dt><dd><a href={target.sourceUrl} target="_blank" rel="noreferrer">{new URL(target.sourceUrl).hostname} ↗</a></dd></div>}
          </dl>}
        </div>
        <div className="targets-head-count">
          <span>INTELLIGENCE</span>
          <strong className={`intel-score ${(live?.intel_score ?? 0) >= 60 ? "is-hot" : (live?.intel_score ?? 0) >= 30 ? "is-warm" : ""}`}>{live?.intel_score ?? 0}</strong>
          <small>roles {intel.roles ?? 0} · posts {intel.posts ?? 0} · contacts {intel.contacts ?? 0} · dossiers {intel.cards ?? 0}</small>
          <small>{outreach ? "On the reach-out list" : "Held, not contacted"} · {STAGE_LABEL[stage]}{live?.outreach_owner ? ` · ${live.outreach_owner}` : ""}</small>
          <small>Careers {live?.careers_status ?? "not swept"} · researched {date(live?.last_scouted_at)} · changed {date(live?.last_change_at)}</small>
        </div>
      </section>

      {!live && <p className="notice error">This company is on the target file but not in the database yet. <Link href="/targets">Sync the target list</Link> to research it.</p>}

      {live && <div className="account-grid">
        <section className="run-kind account-panel">
          <header><span className="eyebrow">Reach-out</span><h2>Who works it and where it stands</h2></header>
          <OutreachForm accountId={live.id} tier={tier} outreach={outreach} manual={live.outreach_manual ?? null} stage={stage} owner={live.outreach_owner ?? ""} notes={live.outreach_notes ?? ""} owners={owners} />
        </section>
        <section className="run-kind account-panel">
          <header><span className="eyebrow">Look again now</span><h2>Sweep or research this company</h2><p>The sweep reads the careers page, job boards and AI posts with no research model. Research puts the model on the public web for managers asking for help, mandates and growth events.</p></header>
          <RunPanel kind="sweep" endpoint="/api/sweep/run" initialRun={null} batchSize={1} projectedMaxCostUsd={0} showHistory startLabel={`Sweep ${name} now`} startBody={{ accountIds: [live.id] }} />
          <RunPanel initialRun={null} batchSize={1} projectedMaxCostUsd={maxCostPerAccountUsd()} showHistory startLabel={`Research ${name} now`} startBody={{ accountIds: [live.id] }} />
        </section>
      </div>}

      {live && <div className="account-sections">
        <section className="target-results account-section">
          <header><div><span className="eyebrow">Open target roles</span><h2>{targetPostings.length} {targetPostings.length === 1 ? "role" : "roles"} Nine-67 could do instead</h2></div><span>{otherPostings.length} other postings on file</span></header>
          {targetPostings.length ? <div className="target-table-wrap"><table className="target-directory-table account-table"><thead><tr><th>Title</th><th>Family</th><th>Where</th><th>Posted</th><th>Source</th></tr></thead><tbody>
            {targetPostings.map((posting) => <tr key={posting.id}><td><a href={posting.url} target="_blank" rel="noreferrer"><strong>{posting.title}</strong></a>{posting.department && <small>{posting.department}</small>}</td><td><span>{FAMILY_LABEL[posting.family as JobFamily] ?? posting.family}</span></td><td><span>{posting.location ?? "—"}</span></td><td><span>{date(posting.posted_at ?? posting.first_seen_at)}</span></td><td><span>{posting.source ?? "careers page"}</span></td></tr>)}
          </tbody></table></div> : <p className="coverage-note account-empty">No open target roles on file{live.careers_status ? ` (careers page: ${live.careers_status})` : ", the careers page has not been swept"}.</p>}
          {otherPostings.length > 0 && <details className="account-more"><summary>{otherPostings.length} other postings read, not in a target family or now closed</summary><ul>{otherPostings.slice(0, 40).map((posting) => <li key={posting.id}><a href={posting.url} target="_blank" rel="noreferrer">{posting.title}</a>{!posting.active && <small> · closed</small>}{posting.family && <small> · {FAMILY_LABEL[posting.family as JobFamily] ?? posting.family}</small>}</li>)}</ul></details>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">AI posts</span><h2>{posts.length} {posts.length === 1 ? "post" : "posts"} by people at {name}</h2></div></header>
          {posts.length ? <ul className="account-list">{posts.map((post) => <li key={post.id}><div><strong>{post.author_name}</strong>{post.author_title && <span> · {post.author_title}</span>}<small> · {post.platform || "web"} · {date(post.posted_at ?? post.created_at)}{post.topic ? ` · ${post.topic}` : ""}</small></div><p>{post.excerpt}</p><a href={post.url} target="_blank" rel="noreferrer">Read the post ↗</a></li>)}</ul> : <p className="coverage-note account-empty">No AI posts found yet.</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">People</span><h2>{people.length} {people.length === 1 ? "person" : "people"} on file</h2></div><span>{people.filter((person) => person.email_status === "verified").length} verified emails</span></header>
          {people.length ? <div className="target-table-wrap"><table className="target-directory-table account-table"><thead><tr><th>Name</th><th>Title</th><th>Level</th><th>Email</th><th>LinkedIn</th></tr></thead><tbody>
            {people.map((person) => <tr key={person.id}><td><strong>{person.full_name}</strong><small>{person.source === "signal" ? "from a signal" : person.source}{person.enriched_at ? ` · ${date(person.enriched_at)}` : ""}</small></td><td><span>{person.title}</span></td><td><span>{person.level}</span></td><td><span>{person.email ?? "—"}</span>{person.email && <small>{person.email_status}</small>}</td><td>{person.linkedin_url ? <a href={person.linkedin_url} target="_blank" rel="noreferrer">Profile ↗</a> : <span>—</span>}</td></tr>)}
          </tbody></table></div> : <p className="coverage-note account-empty">No contacts on file yet. Contacts are enriched for reach-out companies during the sweep.</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">Signals</span><h2>{signals.length} {signals.length === 1 ? "signal" : "signals"} found</h2></div></header>
          {signals.length ? <ul className="account-list">{signals.map((signal) => <li key={signal.id}><div><strong>{signal.raw?.evidence_kind?.replace(/_/g, " ") ?? signal.type.replace(/_/g, " ")}</strong><small> · {date(signal.observed_at)}{signal.people ? ` · ${signal.people.full_name}, ${signal.people.title}` : ""}</small></div><p>{signal.summary}</p>{signal.raw?.operating_need && <p className="account-need"><b>Operating need:</b> {signal.raw.operating_need}</p>}<a href={signal.source_url} target="_blank" rel="noreferrer">Source ↗</a></li>)}</ul> : <p className="coverage-note account-empty">No qualified signal yet.</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">Dossiers and touches</span><h2>{openCards.length} open · {cards.length} ever drafted</h2></div><span>{touches.filter((touch) => touch.sent_at).length} sent · {touches.filter((touch) => touch.reply_at).length} replied</span></header>
          {cards.length ? <ul className="account-list">{cards.map((card) => { const own = touches.filter((touch) => touch.card_id === card.id); return <li key={card.id}><div><strong>{card.people?.full_name ?? "Unknown person"}</strong>{card.people?.title && <span> · {card.people.title}</span>}<small> · score {card.score} · {card.status} · {card.assigned_to} · {date(card.created_at)}</small></div><p>{card.why_now}</p>{own.length > 0 && <small className="account-touches">{own.map((touch) => `${touch.channel.replace(/_/g, " ")} ${touch.sent_at ? `sent ${date(touch.sent_at)}` : "drafted"}${touch.reply_at ? ` · reply ${touch.reply_classification} ${date(touch.reply_at)}` : ""}`).join(" · ")}</small>}{["new", "approved", "edited", "snoozed"].includes(card.status) && <Link href={`/desk?card=${card.id}&account=${domain}`}>Open on the desk →</Link>}</li>; })}</ul> : <p className="coverage-note account-empty">{outreach ? "No dossier drafted yet. One is written when a signal names work Nine-67 could do and a decision owner is on file." : "Held companies do not get dossiers. Put it on the reach-out list above to change that."}</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">Run history</span><h2>Last {history.length} {history.length === 1 ? "run" : "runs"} that touched {name}</h2></div></header>
          {history.length ? <div className="target-table-wrap"><table className="target-directory-table account-table"><thead><tr><th>When</th><th>Run</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>
            {history.map((row, index) => <tr key={index}><td><span>{date(row.started_at ?? row.runs?.started_at ?? null)}</span></td><td><span>{RUN_LABEL[row.runs?.source ?? ""] ?? row.runs?.source ?? "run"}</span></td><td><span className={`status-chip ${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span></td><td><span>{row.status === "error" ? `${row.error_code ?? "error"}: ${row.error_message?.split(/\r?\n/)[0] ?? ""}` : row.note ?? [row.signals_kept ? `${row.signals_kept} signals` : null, row.cards_created ? `${row.cards_created} dossiers` : null].filter(Boolean).join(" · ") ?? "—"}</span></td></tr>)}
          </tbody></table></div> : <p className="coverage-note account-empty">No run has reached this company yet.</p>}
        </section>
      </div>}
    </main>
  </div>;
}
