import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { OutreachForm } from "@/components/OutreachForm";
import { RecheckButton } from "@/components/RecheckButton";
import { requireUser } from "@/lib/auth";
import { FAMILY_LABEL, type JobFamily } from "@/lib/job-sweep/classify";
import { isOutreachStage, type OutreachStage } from "@/lib/outreach";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { TIER_DEFINITION, targetAccountByDomain, type TargetTier } from "@/lib/target-accounts";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

type Posting = { id: string; title: string; url: string; location: string | null; department: string | null; family: string | null; source: string | null; posted_at: string | null; first_seen_at: string; active: boolean };
type Post = { id: string; author_name: string; author_title: string; url: string; platform: string; topic: string; excerpt: string; posted_at: string | null; created_at: string };
type Person = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; linkedin_url: string | null; source: string; enriched_at: string | null };
type SignalRow = { id: string; type: string; summary: string; source_url: string; observed_at: string; raw: { operating_need?: string; evidence_kind?: string } | null; people: { full_name: string; title: string } | null };
type CardRow = { id: string; status: string; score: number; channel: string; why_now: string; brief: string; assigned_to: string; created_at: string; people: { full_name: string; title: string } | null };
type TouchRow = { id: string; channel: string; sent_at: string | null; sent_by: string; reply_at: string | null; reply_classification: string; card_id: string };
type HistoryRow = { status: string; note: string | null; error_code: string | null; error_message: string | null; signals_kept: number | null; cards_created: number | null; started_at: string | null; runs: { source: string; started_at: string } | null };

const RUN_LABEL: Record<string, string> = { scheduled: "Nightly research", manual: "Research", sweep: "Hourly sweep", sweep_manual: "Sweep" };
const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", ok: "Found something", no_signal: "Nothing new", error: "Failed", cancelled: "Stopped" };
const LEVEL_LABEL: Record<string, string> = { owner: "Decision owner", influencer: "Influencer", adjacent: "Adjacent", unknown: "" };
const EMAIL_LABEL: Record<string, string> = { verified: "verified", catch_all: "catch-all", unverified: "unverified", none: "" };
const OPEN = ["new", "approved", "edited", "snoozed"];

function date(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}
function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

/** One company: why to reach out, what was found (every line opens its source), and who works it. */
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

  const [postings, posts, people, signals, cards, history, ownerRows] = live ? await Promise.all([
    db.from("job_postings").select("id,title,url,location,department,family,source,posted_at,first_seen_at,active").eq("account_id", live.id).order("active", { ascending: false }).order("family", { ascending: true, nullsFirst: false }).order("first_seen_at", { ascending: false }).limit(80).then((result) => (result.data ?? []) as Posting[]),
    db.from("public_posts").select("id,author_name,author_title,url,platform,topic,excerpt,posted_at,created_at").eq("account_id", live.id).order("posted_at", { ascending: false, nullsFirst: false }).limit(30).then((result) => (result.data ?? []) as Post[]),
    db.from("people").select("id,full_name,title,level,email,email_status,linkedin_url,source,enriched_at").eq("account_id", live.id).eq("do_not_contact", false).order("level").order("full_name").limit(60).then((result) => (result.data ?? []) as Person[]),
    db.from("signals").select("id,type,summary,source_url,observed_at,raw,people(full_name,title)").eq("account_id", live.id).order("observed_at", { ascending: false }).limit(30).then((result) => (result.data ?? []) as unknown as SignalRow[]),
    db.from("cards").select("id,status,score,channel,why_now,brief,assigned_to,created_at,people(full_name,title)").eq("account_id", live.id).order("score", { ascending: false }).limit(20).then((result) => (result.data ?? []) as unknown as CardRow[]),
    db.from("run_accounts").select("status,note,error_code,error_message,signals_kept,cards_created,started_at,runs(source,started_at)").eq("account_id", live.id).order("created_at", { ascending: false }).limit(12).then((result) => (result.data ?? []) as unknown as HistoryRow[]),
    db.from("accounts").select("outreach_owner").not("outreach_owner", "is", null).limit(200).then((result) => (result.data ?? []) as Array<{ outreach_owner: string }>),
  ]) : [[], [], [], [], [], [], []] as [Posting[], Post[], Person[], SignalRow[], CardRow[], HistoryRow[], Array<{ outreach_owner: string }>];
  const touches = cards.length ? ((await db.from("touches").select("id,channel,sent_at,sent_by,reply_at,reply_classification,card_id").in("card_id", cards.map((card) => card.id)).order("created_at", { ascending: false })).data ?? []) as TouchRow[] : [];
  const owners = [...new Set(["Josh", "Jenna", ...ownerRows.map((row) => row.outreach_owner)])].sort((a, b) => a.localeCompare(b));
  const targetPostings = postings.filter((posting) => posting.active && posting.family);
  const otherPostings = postings.filter((posting) => !(posting.active && posting.family));
  const openCards = cards.filter((card) => OPEN.includes(card.status));
  const pastCards = cards.filter((card) => !OPEN.includes(card.status));
  const score = live?.intel_score ?? 0;
  const found = [targetPostings.length ? `${targetPostings.length} open ${targetPostings.length === 1 ? "role" : "roles"} Nine-67 could do` : null, people.length ? `${people.length} ${people.length === 1 ? "person" : "people"}` : null, posts.length ? `${posts.length} AI ${posts.length === 1 ? "post" : "posts"}` : null].filter(Boolean).join(" · ");

  return <div className="shell">
    <Header />
    <main className="targets-page account-page">
      <p className="account-crumbs"><Link href="/outreach">← Reach-out list</Link></p>

      <section className="targets-head has-hero account-head">
        <div>
          <span className="eyebrow">{tier ? `Tier ${tier}` : "Not on the file"}{!outreach ? " · held, not contacted" : ""}{live?.outreach_manual === true ? " · added by hand" : ""}</span>
          <h1>{name}</h1>
          <p className="account-line">
            <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain} ↗</a>
            {target && <>{target.vertical && <span>{target.vertical}{target.subSegment ? `, ${target.subSegment}` : ""}</span>}{target.hqCity && <span>{target.hqCity}, {target.hqState}</span>}<span>{target.ownership}{target.peSponsor ? ` (${target.peSponsor})` : ""}</span><span>${target.revenueBand}{target.revenueEstimateUsdM ? ` · ≈ $${target.revenueEstimateUsdM.toLocaleString()}M` : ""}</span>{target.employees && <span>{target.employees.toLocaleString()} employees</span>}{target.ceo && <span>CEO {target.ceo}</span>}</>}
          </p>
          {target && (target.aiSignal || target.targetTitles.length > 0) && <p className="account-line account-line-muted">{target.aiSignal && <span>AI on file: {target.aiSignal}</span>}{target.targetTitles.length > 0 && <span>Likely buyers: {target.targetTitles.join(", ")}</span>}</p>}
        </div>
        <div className="targets-head-count">
          <span>FOUND SO FAR</span>
          <strong className={`intel-score ${score >= 60 ? "is-hot" : score >= 30 ? "is-warm" : ""}`}>{score}</strong>
          <small>{found || (live?.careers_status || live?.last_scouted_at ? "Nothing yet" : "Not scanned yet")}</small>
          {live?.last_change_at && <small>Last change {date(live.last_change_at)}</small>}
        </div>
      </section>

      {!live && <p className="notice error">This company is on the file but not in the database yet. Open the <Link href="/outreach">reach-out list</Link> once and it will be written.</p>}

      {live && <section className="account-bar">
        <OutreachForm compact accountId={live.id} tier={tier} outreach={outreach} manual={live.outreach_manual ?? null} stage={stage} owner={live.outreach_owner ?? ""} notes={live.outreach_notes ?? ""} owners={owners} />
        <RecheckButton accountId={live.id} name={name} />
      </section>}

      {live && <div className="account-sections">
        <section className="target-results account-section">
          <header><div><span className="eyebrow">Reach out</span><h2>{openCards.length ? `${openCards.length} drafted and ready` : "Nothing drafted yet"}</h2></div></header>
          {openCards.length ? <ul className="click-list">{openCards.map((card) => <li key={card.id}><Link href={`/desk?card=${card.id}&account=${domain}`}>
            <b className={`intel-score ${card.score >= 75 ? "is-hot" : "is-warm"}`}>{card.score}</b>
            <div><strong>{card.people?.full_name ?? "Unknown person"}{card.people?.title ? `, ${card.people.title}` : ""}</strong><p>{card.why_now}</p><small>{card.status === "new" ? "New" : card.status} · {card.channel.replace(/_/g, " ")} · {card.assigned_to}</small></div>
            <em>Open the draft →</em>
          </Link></li>)}</ul>
          : <p className="account-empty">{!outreach ? "Held companies get no draft. Put it on the list above to change that." : signals.length ? "A signal is on file (below) but no decision owner with a path yet, so nothing was drafted." : targetPostings.length || posts.length ? "Roles and posts are on file; the research pass writes the draft once it finds a manager behind them." : "Nothing found to write about yet."}</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">Hiring</span><h2>{targetPostings.length ? `${targetPostings.length} open ${targetPostings.length === 1 ? "role" : "roles"} Nine-67 could do instead` : "No open target roles"}</h2></div>{live.careers_url && <a href={live.careers_url} target="_blank" rel="noreferrer" className="outreach-open">Careers page ↗</a>}</header>
          {targetPostings.length ? <ul className="click-list">{targetPostings.map((posting) => <li key={posting.id}><a href={posting.url} target="_blank" rel="noreferrer">
            <b className="click-tag">{FAMILY_LABEL[posting.family as JobFamily] ?? posting.family}</b>
            <div><strong>{posting.title}</strong><small>{[posting.department, posting.location, posting.posted_at ? `posted ${date(posting.posted_at)}` : `seen ${date(posting.first_seen_at)}`, posting.source ?? host(posting.url)].filter(Boolean).join(" · ")}</small></div>
            <em>Open ↗</em>
          </a></li>)}</ul>
          : <p className="account-empty">{live.careers_status === "none" ? "No careers page could be found for this company." : live.careers_status ? "The careers page was read; nothing in a target family is open." : "The careers page has not been read yet."}</p>}
          {otherPostings.length > 0 && <details className="account-more"><summary>{otherPostings.length} other postings read (not a target family, or closed)</summary><ul className="click-list compact">{otherPostings.slice(0, 40).map((posting) => <li key={posting.id}><a href={posting.url} target="_blank" rel="noreferrer"><div><strong>{posting.title}</strong><small>{[posting.active ? null : "closed", posting.family ? FAMILY_LABEL[posting.family as JobFamily] : null, posting.location].filter(Boolean).join(" · ")}</small></div><em>Open ↗</em></a></li>)}</ul></details>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">People</span><h2>{people.length ? `${people.length} ${people.length === 1 ? "person" : "people"} on file` : "No contacts yet"}</h2></div><span>{people.filter((person) => person.email_status === "verified").length} verified {people.filter((person) => person.email_status === "verified").length === 1 ? "email" : "emails"}</span></header>
          {people.length ? <ul className="click-list">{people.map((person) => { const href = person.linkedin_url ?? (person.email ? `mailto:${person.email}` : null); const inner = <>
            <b className="click-tag">{LEVEL_LABEL[person.level] || "Contact"}</b>
            <div><strong>{person.full_name}</strong><small>{person.title}</small><small>{person.email ? `${person.email}${EMAIL_LABEL[person.email_status] ? ` (${EMAIL_LABEL[person.email_status]})` : ""}` : "no email on file"}</small></div>
            <em>{person.linkedin_url ? "LinkedIn ↗" : person.email ? "Email →" : ""}</em></>;
            return <li key={person.id}>{href ? <a href={href} target={person.linkedin_url ? "_blank" : undefined} rel="noreferrer">{inner}</a> : <span className="click-static">{inner}</span>}</li>; })}</ul>
          : <p className="account-empty">{outreach ? "Contacts are looked up during the scan once a reason to reach out exists." : "Held companies are not enriched."}</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">Talking about AI</span><h2>{posts.length ? `${posts.length} ${posts.length === 1 ? "post" : "posts"} by people here` : "No AI posts found"}</h2></div></header>
          {posts.length ? <ul className="click-list">{posts.map((post) => <li key={post.id}><a href={post.url} target="_blank" rel="noreferrer">
            <b className="click-tag">{post.platform || host(post.url)}</b>
            <div><strong>{post.author_name}{post.author_title ? `, ${post.author_title}` : ""}</strong><p>{post.excerpt}</p><small>{[date(post.posted_at ?? post.created_at), post.topic].filter(Boolean).join(" · ")}</small></div>
            <em>Read ↗</em>
          </a></li>)}</ul> : <p className="account-empty">Nothing found yet.</p>}
        </section>

        <section className="target-results account-section">
          <header><div><span className="eyebrow">What the research found</span><h2>{signals.length ? `${signals.length} ${signals.length === 1 ? "signal" : "signals"}` : "No signal yet"}</h2></div></header>
          {signals.length ? <ul className="click-list">{signals.map((signal) => <li key={signal.id}><a href={signal.source_url} target="_blank" rel="noreferrer">
            <b className="click-tag">{(signal.raw?.evidence_kind ?? signal.type).replace(/_/g, " ")}</b>
            <div><strong>{signal.summary}</strong>{signal.raw?.operating_need && <p>Need: {signal.raw.operating_need}</p>}<small>{[date(signal.observed_at), signal.people ? `${signal.people.full_name}, ${signal.people.title}` : null, host(signal.source_url)].filter(Boolean).join(" · ")}</small></div>
            <em>Source ↗</em>
          </a></li>)}</ul> : <p className="account-empty">{live.last_scouted_at ? `Researched ${date(live.last_scouted_at)}; nothing qualified.` : "The research model has not looked at this company yet."}</p>}
        </section>

        <details className="account-more account-history">
          <summary>History: {touches.filter((touch) => touch.sent_at).length} sent · {touches.filter((touch) => touch.reply_at).length} replied · {pastCards.length} past drafts · {history.length} runs{target?.sourceUrl ? " · where the company came from" : ""}</summary>
          {touches.length > 0 && <ul className="click-list compact">{touches.map((touch) => { const card = cards.find((item) => item.id === touch.card_id); return <li key={touch.id}><Link href={`/desk?card=${touch.card_id}&account=${domain}`}><div><strong>{card?.people?.full_name ?? "Unknown"} · {touch.channel.replace(/_/g, " ")}</strong><small>{touch.sent_at ? `sent ${date(touch.sent_at)} by ${touch.sent_by}` : "drafted, not sent"}{touch.reply_at ? ` · reply ${touch.reply_classification} ${date(touch.reply_at)}` : ""}</small></div><em>Open →</em></Link></li>; })}</ul>}
          {pastCards.length > 0 && <ul className="click-list compact">{pastCards.map((card) => <li key={card.id}><Link href={`/desk?card=${card.id}&account=${domain}`}><div><strong>{card.people?.full_name ?? "Unknown"} · {card.status}</strong><small>{card.why_now}</small></div><em>Open →</em></Link></li>)}</ul>}
          {history.length > 0 && <ul className="click-list compact static">{history.map((row, index) => <li key={index}><span className="click-static"><b className="click-tag">{STATUS_LABEL[row.status] ?? row.status}</b><div><strong>{RUN_LABEL[row.runs?.source ?? ""] ?? "Run"} · {date(row.started_at ?? row.runs?.started_at ?? null)}</strong><small>{row.status === "error" ? `${row.error_code ?? "error"}: ${row.error_message?.split(/\r?\n/)[0] ?? ""}` : (row.note ?? [row.signals_kept ? `${row.signals_kept} signals` : null, row.cards_created ? `${row.cards_created} drafts` : null].filter(Boolean).join(" · ")) || "—"}</small></div></span></li>)}</ul>}
          {target && <p className="account-empty">{tier ? `${TIER_DEFINITION[tier]}. ` : ""}{target.notes ? `${target.notes}. ` : ""}{target.dropReason ? `Removed: ${target.dropReason}. ` : ""}{target.sourceUrl && <a href={target.sourceUrl} target="_blank" rel="noreferrer">Source: {host(target.sourceUrl)} ↗</a>}</p>}
        </details>
      </div>}
    </main>
  </div>;
}
