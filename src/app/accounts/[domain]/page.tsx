import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { MigrationRequired } from "@/components/MigrationRequired";
import { CopyButton } from "@/components/CopyButton";
import { OutreachForm } from "@/components/OutreachForm";
import { RecheckButton } from "@/components/RecheckButton";
import { EvidenceTabs } from "@/components/EvidenceTabs";
import { CompanyRows } from "@/components/CompanyRows";
import { requireUser } from "@/lib/auth";
import { FAMILY_LABEL, type JobFamily } from "@/lib/job-sweep/classify";
import { isOutreachStage, STAGE_LABEL, type OutreachStage } from "@/lib/outreach";
import { parseStoredAnalysis } from "@/lib/analysis";
import { buildBrief } from "@/lib/prospect-brief";
import { pendingMigrations } from "@/lib/schema-check";
import { admin } from "@/lib/supabase/admin";
import { TIER_DEFINITION, targetAccountByDomain, type TargetTier } from "@/lib/target-accounts";
import type { Account } from "@/lib/types";

export const dynamic = "force-dynamic";

type Posting = { id: string; title: string; url: string; location: string | null; department: string | null; family: string | null; source: string | null; posted_at: string | null; first_seen_at: string; active: boolean };
type Post = { id: string; person_id: string | null; author_name: string; author_title: string; url: string; platform: string; topic: string; excerpt: string; posted_at: string | null; created_at: string };
type Person = { id: string; full_name: string; title: string; level: string; email: string | null; email_status: string; email_source: string | null; phone: string | null; contact_notes: string | null; linkedin_url: string | null; source: string; enriched_at: string | null };
type SignalRow = { id: string; type: string; summary: string; source_url: string; observed_at: string; raw: { operating_need?: string; evidence_kind?: string } | null; people: { full_name: string; title: string } | null };
type CardRow = { id: string; person_id: string; status: string; score: number; channel: string; why_now: string; brief: string; email_subject: string | null; email_body: string | null; linkedin_note: string | null; linkedin_comment: string | null; assigned_to: string; created_at: string; people: { full_name: string; title: string } | null };
type TouchRow = { id: string; person_id: string; channel: string; sent_at: string | null; sent_by: string; reply_at: string | null; reply_classification: string; card_id: string };
type HistoryRow = { status: string; note: string | null; error_code: string | null; error_message: string | null; signals_kept: number | null; cards_created: number | null; started_at: string | null; runs: { source: string; started_at: string } | null };

const RUN_LABEL: Record<string, string> = { scheduled: "Nightly research", manual: "Research", sweep: "Hourly sweep", sweep_manual: "Sweep" };
const STATUS_LABEL: Record<string, string> = { queued: "Queued", running: "Running", ok: "Found something", no_signal: "Nothing new", error: "Failed", cancelled: "Stopped" };
const LEVEL_LABEL: Record<string, string> = { owner: "Decision owner", influencer: "Influencer", adjacent: "Adjacent", unknown: "" };
const EMAIL_LABEL: Record<string, string> = { verified: "verified", catch_all: "catch-all", unverified: "unverified", none: "" };
const OPEN = ["new", "approved", "edited", "snoozed"];
/** Title fragments that mark the person who owns the budget for a kind of hire. */
const BUYER_HINTS: Record<string, string[]> = {
  ai_ml: ["technology", "cto", "engineering", "data", "digital", "ai"], automation: ["operating", "coo", "operations", "transformation", "chief of staff"],
  data_analyst: ["data", "analytics", "financial", "cfo", "finance", "intelligence"], revops: ["revenue", "cro", "sales"], ops_analyst: ["operating", "coo", "operations", "chief of staff"],
  systems_integration: ["information", "cio", "it", "technology", "systems", "applications"], crm_admin: ["revenue", "sales", "marketing", "systems"],
};

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
    db.from("public_posts").select("id,person_id,author_name,author_title,url,platform,topic,excerpt,posted_at,created_at").eq("account_id", live.id).order("posted_at", { ascending: false, nullsFirst: false }).limit(30).then((result) => (result.data ?? []) as Post[]),
    db.from("people").select("id,full_name,title,level,email,email_status,email_source,phone,contact_notes,linkedin_url,source,enriched_at").eq("account_id", live.id).eq("do_not_contact", false).order("level").order("full_name").limit(60).then((result) => (result.data ?? []) as Person[]),
    db.from("signals").select("id,type,summary,source_url,observed_at,raw,people(full_name,title)").eq("account_id", live.id).order("observed_at", { ascending: false }).limit(30).then((result) => (result.data ?? []) as unknown as SignalRow[]),
    db.from("cards").select("id,person_id,status,score,channel,why_now,brief,email_subject,email_body,linkedin_note,linkedin_comment,assigned_to,created_at,people(full_name,title)").eq("account_id", live.id).order("score", { ascending: false }).limit(20).then((result) => (result.data ?? []) as unknown as CardRow[]),
    db.from("run_accounts").select("status,note,error_code,error_message,signals_kept,cards_created,started_at,runs(source,started_at)").eq("account_id", live.id).order("created_at", { ascending: false }).limit(12).then((result) => (result.data ?? []) as unknown as HistoryRow[]),
    db.from("accounts").select("outreach_owner").not("outreach_owner", "is", null).limit(200).then((result) => (result.data ?? []) as Array<{ outreach_owner: string }>),
  ]) : [[], [], [], [], [], [], []] as [Posting[], Post[], Person[], SignalRow[], CardRow[], HistoryRow[], Array<{ outreach_owner: string }>];
  const touches = cards.length ? ((await db.from("touches").select("id,person_id,channel,sent_at,sent_by,reply_at,reply_classification,card_id").in("card_id", cards.map((card) => card.id)).order("created_at", { ascending: false })).data ?? []) as TouchRow[] : [];
  const owners = [...new Set(["Josh", ...ownerRows.map((row) => row.outreach_owner)])].sort((a, b) => a.localeCompare(b));
  const targetPostings = postings.filter((posting) => posting.active && posting.family);
  const otherPostings = postings.filter((posting) => !(posting.active && posting.family));
  const openCards = cards.filter((card) => OPEN.includes(card.status));
  const pastCards = cards.filter((card) => !OPEN.includes(card.status));
  const score = live?.intel_score ?? 0;
  const analysis = parseStoredAnalysis(live?.analysis);
  const brief = buildBrief({
    name, tier, aiSignalOnFile: target?.aiSignal ?? "",
    roles: targetPostings.map((posting) => ({ title: posting.title, family: posting.family ?? "", postedAt: posting.posted_at ?? posting.first_seen_at })),
    posts: posts.map((post) => ({ author: post.author_name, title: post.author_title, topic: post.topic, postedAt: post.posted_at ?? post.created_at })),
    signals: signals.map((signal) => ({ kind: signal.raw?.evidence_kind ?? signal.type, summary: signal.summary, need: signal.raw?.operating_need ?? null, observedAt: signal.observed_at })),
    people: people.map((person) => ({ name: person.full_name, title: person.title, level: person.level, hasEmail: Boolean(person.email), verified: person.email_status === "verified" })),
    drafts: cards.map((card) => ({ person: card.people?.full_name ?? "someone", status: card.status, score: card.score })),
    touches: touches.map((touch) => ({ person: cards.find((card) => card.id === touch.card_id)?.people?.full_name ?? "someone", channel: touch.channel, sentAt: touch.sent_at, replyAt: touch.reply_at, reply: touch.reply_classification })),
    stage, owner: live?.outreach_owner ?? "", notes: live?.outreach_notes ?? "", now: new Date(),
  });
  // Who to write to: decision owners with a draft, a post, or an address first.
  const buyerTitles = new Set(targetPostings.flatMap((posting) => BUYER_HINTS[posting.family ?? ""] ?? []).map((title) => title.toLowerCase()));
  const ranked = people.map((person) => {
    const own = cards.filter((card) => card.person_id === person.id);
    const theirPosts = posts.filter((post) => post.person_id === person.id || post.author_name.toLowerCase() === person.full_name.toLowerCase());
    const theirTouches = touches.filter((touch) => touch.person_id === person.id);
    const score = (person.level === "owner" ? 3 : person.level === "influencer" ? 2 : person.level === "adjacent" ? 1 : 0)
      + (own.some((card) => OPEN.includes(card.status)) ? 4 : own.length ? 1 : 0)
      + (theirPosts.length ? 2 : 0)
      + (person.email_status === "verified" ? 2 : person.email ? 1 : 0)
      + ([...buyerTitles].some((title) => person.title.toLowerCase().includes(title)) ? 2 : 0);
    return { person, cards: own, posts: theirPosts, touches: theirTouches, score };
  }).sort((a, b) => b.score - a.score).slice(0, 5);

  const lastSent = touches.filter((touch) => touch.sent_at).sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!))[0];
  const lastReply = touches.filter((touch) => touch.reply_at).sort((a, b) => Date.parse(b.reply_at!) - Date.parse(a.reply_at!))[0];
  const stageTone = ["replied", "meeting", "won"].includes(stage) ? "ok" : stage === "contacted" ? "accent" : ["lost", "hold", "untouched"].includes(stage) ? "muted" : "info";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
  const whyLines = analysis?.brief.whyNow ? [analysis.brief.whyNow, analysis.brief.angle ? `The angle: ${analysis.brief.angle}` : ""].filter(Boolean) : brief.why;
  const listRow = live ? [{ id: live.id, domain, name, industry: target?.vertical ?? "", subSegment: target?.subSegment ?? "", hq: [target?.hqCity, target?.hqState].filter(Boolean).join(", "), tier: tier ?? "", outreach, manual: live.outreach_manual !== null && live.outreach_manual !== undefined, intel: score, roles: targetPostings.length, posts: posts.length, contacts: people.length, verified: people.filter((person) => person.email_status === "verified").length, stage, owner: live.outreach_owner ?? "", lastChange: live.last_change_at ?? null, scanned: Boolean(live.careers_status || live.last_scouted_at), drafts: openCards.length, dropReason: target?.dropReason ?? "" }] : [];

  return <div className="shell">
    <Header />
    <main className="targets-page account-page">
      <p className="crumbs"><Link href="/outreach">Reach-out list</Link><span>/</span><span>{name}</span></p>

      <header className="card record-head">
        <div className="record-id">
          <span className="avatar avatar-lg">{initials}</span>
          <div>
            <h1>{name} <span className={`pill pill-${outreach ? "ink" : "muted"}`}><i />{tier ? `Tier ${tier}` : "Not on file"}{!outreach ? " · held" : ""}</span></h1>
            <p className="record-meta">
              <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain} ↗</a>
              {target?.vertical && <span>{target.vertical}{target.subSegment ? `, ${target.subSegment}` : ""}</span>}
              {target?.hqCity && <span>{target.hqCity}, {target.hqState}</span>}
              {target?.ownership && <span>{target.ownership}{target.peSponsor ? ` (${target.peSponsor})` : ""}</span>}
              {target?.revenueBand && <span>${target.revenueBand}{target.revenueEstimateUsdM ? ` · ≈ $${target.revenueEstimateUsdM.toLocaleString()}M` : ""}</span>}
              {target?.employees && <span>{target.employees.toLocaleString()} employees</span>}
            </p>
          </div>
        </div>
        <div className="record-stats">
          <div><span>Score</span><strong className={`score ${score >= 60 ? "is-hot" : score >= 30 ? "is-warm" : ""}`}>{score}</strong></div>
          <div><span>Target roles</span><strong>{targetPostings.length}</strong></div>
          <div><span>People</span><strong>{people.length}</strong></div>
          <div><span>AI posts</span><strong>{posts.length}</strong></div>
          <div><span>Drafts</span><strong>{openCards.length}</strong></div>
        </div>
        {live && <div className="record-actions"><RecheckButton accountId={live.id} name={name} /></div>}
      </header>

      {!live && <p className="notice error">This company is on the file but not in the database yet. Open the <Link href="/outreach">reach-out list</Link> once and it will be written.</p>}

      {live && <div className="record-grid">
        <div className="record-main">
          <section className="card pad">
            <div className="card-title"><h2>Why now</h2><span className="pill pill-muted"><i />{analysis?.analyzedAt ? `Agent swarm · ${date(analysis.analyzedAt)}${analysis.brief.fit ? ` · fit ${analysis.brief.fit}/100` : ""}` : "From what is on file"}</span></div>
            <ul className="why-list">{whyLines.map((line, index) => <li key={index}>{line}</li>)}</ul>
            {analysis?.brief.opener && <blockquote className="brief-opener">{analysis.brief.opener}</blockquote>}
            <div className="next-step"><span>Next step</span><p>{analysis?.brief.nextStep || brief.next}</p></div>
            {analysis && analysis.brief.objections.length > 0 && <details className="brief-objections"><summary>Likely pushback and the answers</summary><ul>{analysis.brief.objections.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}
          </section>

          <section className="card" id="who">
            <div className="card-title pad-x"><h2>People</h2><span className="muted">{people.filter((person) => person.email).length} with an address · {people.filter((person) => person.email_status === "verified").length} verified{live.email_pattern ? ` · format ${live.email_pattern}@${domain}` : ""}</span></div>
            {people.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Reach</th><th>Last touch</th><th>Draft</th></tr></thead><tbody>
              {ranked.map(({ person, cards: own, posts: theirPosts, touches: theirTouches }, index) => {
                const draft = own.filter((card) => OPEN.includes(card.status)).sort((a, b) => b.score - a.score)[0] ?? own[0];
                const lastTouch = theirTouches.filter((touch) => touch.sent_at).sort((a, b) => Date.parse(b.sent_at!) - Date.parse(a.sent_at!))[0];
                return <tr key={person.id} className={index === 0 ? "is-first" : ""}>
                  <td><div className="cell-company"><span className="avatar">{person.full_name.split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("")}</span><div><strong>{person.full_name}{index === 0 && <em className="pill pill-accent"><i />Write first</em>}</strong><small>{person.title}{LEVEL_LABEL[person.level] ? ` · ${LEVEL_LABEL[person.level]}` : ""}{theirPosts.length ? ` · posted about ${theirPosts[0].topic || "AI"}` : ""}</small></div></div></td>
                  <td className="cell-who">{person.email ? <a href={`mailto:${person.email}`} onClick={(event) => event.stopPropagation()}>{person.email}</a> : <small>no email</small>}<small>{person.email ? (person.email_source === "pattern" ? "built, unverified" : person.email_source === "web" ? "public page, unverified" : EMAIL_LABEL[person.email_status]) : ""}{person.phone ? ` · ${person.phone}` : ""}{person.linkedin_url ? <> · <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></> : ""}</small></td>
                  <td className="cell-time">{lastTouch ? `${lastTouch.channel.replace(/_/g, " ")} · ${date(lastTouch.sent_at)}${lastTouch.reply_at ? ` · replied` : ""}` : "never"}</td>
                  <td>{draft ? <Link href={`/desk?card=${draft.id}&account=${domain}`} className="btn-secondary">Open draft · {draft.score}</Link> : <small className="muted">none yet</small>}</td>
                </tr>;
              })}
              {people.length > ranked.length && <tr><td colSpan={4} className="cell-more"><details><summary>{people.length - ranked.length} more on file</summary><ul>{people.filter((person) => !ranked.some((item) => item.person.id === person.id)).map((person) => <li key={person.id}><strong>{person.full_name}</strong> · {person.title}{person.email ? ` · ${person.email}` : ""}{person.linkedin_url ? <> · <a href={person.linkedin_url} target="_blank" rel="noreferrer">LinkedIn ↗</a></> : ""}</li>)}</ul></details></td></tr>}
            </tbody></table></div>
            : <p className="card-empty">{outreach ? "Nobody found yet. The next scan looks on the company site, LinkedIn results and press." : "Held companies are not enriched."}{!process.env.APOLLO_API_KEY ? " Verified addresses need APOLLO_API_KEY in the deploy." : ""}</p>}
          </section>

          {ranked.some(({ cards: own }) => own.some((card) => OPEN.includes(card.status))) && <section className="card pad" id="drafts">
            <div className="card-title"><h2>The draft</h2></div>
            {ranked.flatMap(({ person, cards: own }) => own.filter((card) => OPEN.includes(card.status)).slice(0, 1).map((draft) => <div key={draft.id} className="draft">
              <div className="draft-head"><div><strong>To {person.full_name}</strong><small>{person.title} · score {draft.score} · {draft.status}</small></div><div><CopyButton text={draft.channel === "linkedin_first" || draft.channel === "linkedin_only" ? (draft.linkedin_note ?? draft.email_body ?? "") : `${draft.email_subject ?? ""}\n\n${draft.email_body ?? ""}`} label="Copy" /><Link href={`/desk?card=${draft.id}&account=${domain}`} className="btn-primary">Open on the desk</Link></div></div>
              <p className="muted">{draft.why_now}</p>
              {draft.email_subject && <p className="draft-subject">Subject: {draft.email_subject}</p>}
              {draft.email_body && <pre className="who-body">{draft.email_body}</pre>}
              {draft.linkedin_note && <p><b>LinkedIn note:</b> {draft.linkedin_note}</p>}
            </div>))}
          </section>}

          <EvidenceTabs tabs={[
            { id: "roles", label: "Roles", count: targetPostings.length, content: targetPostings.length ? <ul className="click-list">{targetPostings.map((posting) => <li key={posting.id}><a href={posting.url} target="_blank" rel="noreferrer"><b className="click-tag">{FAMILY_LABEL[posting.family as JobFamily] ?? posting.family}</b><div><strong>{posting.title}</strong><small>{[posting.department, posting.location, posting.posted_at ? `posted ${date(posting.posted_at)}` : `seen ${date(posting.first_seen_at)}`, posting.source ?? host(posting.url)].filter(Boolean).join(" · ")}</small></div><em>Open ↗</em></a></li>)}{otherPostings.length > 0 && <li><details className="account-more"><summary>{otherPostings.length} other postings read (not a target family, or closed)</summary><ul>{otherPostings.slice(0, 40).map((posting) => <li key={posting.id}><a href={posting.url} target="_blank" rel="noreferrer">{posting.title}</a>{!posting.active && <small> · closed</small>}</li>)}</ul></details></li>}</ul> : <p className="card-empty">{live.careers_status === "none" ? "No careers page could be found." : live.careers_status ? "Careers page read; nothing in a target family is open." : "Careers page not read yet."}</p> },
            { id: "posts", label: "AI posts", count: posts.length, content: posts.length ? <ul className="click-list">{posts.map((post) => <li key={post.id}><a href={post.url} target="_blank" rel="noreferrer"><b className="click-tag">{post.platform || host(post.url)}</b><div><strong>{post.author_name}{post.author_title ? `, ${post.author_title}` : ""}</strong><p>{post.excerpt}</p><small>{[date(post.posted_at ?? post.created_at), post.topic].filter(Boolean).join(" · ")}</small></div><em>Read ↗</em></a></li>)}</ul> : <p className="card-empty">Nothing found yet.</p> },
            { id: "research", label: "Research", count: signals.length, content: signals.length ? <ul className="click-list">{signals.map((signal) => <li key={signal.id}><a href={signal.source_url} target="_blank" rel="noreferrer"><b className="click-tag">{(signal.raw?.evidence_kind ?? signal.type).replace(/_/g, " ")}</b><div><strong>{signal.summary}</strong>{signal.raw?.operating_need && <p>Need: {signal.raw.operating_need}</p>}<small>{[date(signal.observed_at), signal.people ? `${signal.people.full_name}, ${signal.people.title}` : null, host(signal.source_url)].filter(Boolean).join(" · ")}</small></div><em>Source ↗</em></a></li>)}</ul> : <p className="card-empty">{live.last_scouted_at ? `Researched ${date(live.last_scouted_at)}; nothing qualified.` : "The research model has not looked yet."}</p> },
            { id: "happening", label: "What is happening", count: analysis ? analysis.happening.length + analysis.painPoints.length + (analysis.hiring.read ? 1 : 0) : 0, content: analysis && (analysis.overview || analysis.happening.length || analysis.hiring.read) ? <div className="happening">{analysis.overview && <p className="happening-overview">{analysis.overview}</p>}{analysis.happening.length > 0 && <ul className="click-list compact">{analysis.happening.map((item, index) => <li key={index}>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer"><div><strong>{item.text}</strong>{item.date && <small>{item.date}</small>}</div><em>Source ↗</em></a> : <span className="click-static"><div><strong>{item.text}</strong>{item.date && <small>{item.date}</small>}</div></span>}</li>)}</ul>}{analysis.painPoints.length > 0 && <div className="happening-block"><span className="eyebrow">Problems they have said out loud</span><ul className="click-list compact">{analysis.painPoints.map((item, index) => <li key={index}>{item.source_url ? <a href={item.source_url} target="_blank" rel="noreferrer"><div><strong>{item.text}</strong></div><em>Source ↗</em></a> : <span className="click-static"><div><strong>{item.text}</strong></div></span>}</li>)}</ul></div>}{analysis.hiring.read && <div className="happening-block"><span className="eyebrow">What the hiring means{analysis.hiring.budgetEstimate ? ` · about ${analysis.hiring.budgetEstimate}` : ""}</span><p className="brief-text">{analysis.hiring.read}</p>{analysis.hiring.buildInstead.length > 0 && <ul className="happening-build">{analysis.hiring.buildInstead.map((line, index) => <li key={index}>{line}</li>)}</ul>}</div>}{analysis.tech.length > 0 && <p className="happening-block muted">Uses {analysis.tech.slice(0, 8).join(", ")}</p>}{analysis.problems.length > 0 && <details className="account-more"><summary>{analysis.problems.length} things the agents could not do</summary><ul>{analysis.problems.map((line, index) => <li key={index}>{line}</li>)}</ul></details>}</div> : <p className="card-empty">The agent swarm has not analysed this company yet. Use Analyse again now.</p> },
            { id: "history", label: "History", count: history.length + touches.length + pastCards.length, content: <div>{touches.length > 0 && <ul className="click-list compact">{touches.map((touch) => { const card = cards.find((item) => item.id === touch.card_id); return <li key={touch.id}><Link href={`/desk?card=${touch.card_id}&account=${domain}`}><div><strong>{card?.people?.full_name ?? "Unknown"} · {touch.channel.replace(/_/g, " ")}</strong><small>{touch.sent_at ? `sent ${date(touch.sent_at)} by ${touch.sent_by}` : "drafted, not sent"}{touch.reply_at ? ` · reply ${touch.reply_classification} ${date(touch.reply_at)}` : ""}</small></div><em>Open →</em></Link></li>; })}</ul>}{pastCards.length > 0 && <ul className="click-list compact">{pastCards.map((card) => <li key={card.id}><Link href={`/desk?card=${card.id}&account=${domain}`}><div><strong>{card.people?.full_name ?? "Unknown"} · {card.status}</strong><small>{card.why_now}</small></div><em>Open →</em></Link></li>)}</ul>}{history.length > 0 ? <ul className="click-list compact static">{history.map((row, index) => <li key={index}><span className="click-static"><b className="click-tag">{STATUS_LABEL[row.status] ?? row.status}</b><div><strong>{RUN_LABEL[row.runs?.source ?? ""] ?? "Run"} · {date(row.started_at ?? row.runs?.started_at ?? null)}</strong><small>{row.status === "error" ? `${row.error_code ?? "error"}: ${row.error_message?.split(/\r?\n/)[0] ?? ""}` : (row.note ?? [row.signals_kept ? `${row.signals_kept} signals` : null, row.cards_created ? `${row.cards_created} drafts` : null].filter(Boolean).join(" · ")) || "—"}</small></div></span></li>)}</ul> : <p className="card-empty">No run has reached this company yet.</p>}</div> },
          ]} />
        </div>

        <aside className="record-side">
          <section className="card pad">
            <div className="card-title"><h2>Manage</h2><span className={`pill pill-${stageTone}`}><i />{STAGE_LABEL[stage]}</span></div>
            <OutreachForm accountId={live.id} tier={tier} outreach={outreach} manual={live.outreach_manual ?? null} stage={stage} owner={live.outreach_owner ?? ""} notes={live.outreach_notes ?? ""} owners={owners} />
          </section>
          <section className="card">
            <div className="card-title pad-x"><h2>Reach-out list</h2></div>
            <CompanyRows rows={listRow} />
          </section>
          <section className="card pad">
            <div className="card-title"><h2>Activity</h2></div>
            <dl className="facts">
              <div><dt>Last reach-out</dt><dd>{lastSent ? `${lastSent.channel.replace(/_/g, " ")} · ${date(lastSent.sent_at)}` : "none yet"}</dd></div>
              <div><dt>Last reply</dt><dd>{lastReply ? `${lastReply.reply_classification} · ${date(lastReply.reply_at)}` : lastSent ? "no reply yet" : "—"}</dd></div>
              <div><dt>Sent</dt><dd>{touches.filter((touch) => touch.sent_at).length}</dd></div>
              <div><dt>Careers page</dt><dd>{live.careers_status ?? "not read yet"}</dd></div>
              <div><dt>Researched</dt><dd>{date(live.last_scouted_at) || "not yet"}</dd></div>
              <div><dt>Analysed</dt><dd>{date(live.analysis_at) || "not yet"}</dd></div>
              <div><dt>Last change</dt><dd>{date(live.last_change_at) || "—"}</dd></div>
            </dl>
          </section>
          {target && <section className="card pad">
            <div className="card-title"><h2>On file</h2></div>
            <dl className="facts">
              {target.ceo && <div><dt>CEO</dt><dd>{target.ceo}</dd></div>}
              {target.targetTitles.length > 0 && <div><dt>Likely buyers</dt><dd>{target.targetTitles.join(", ")}</dd></div>}
              {target.aiSignal && <div><dt>AI note</dt><dd>{target.aiSignal}</dd></div>}
              {target.notes && <div><dt>Notes</dt><dd>{target.notes}</dd></div>}
              {analysis?.company.phone && <div><dt>Main line</dt><dd>{analysis.company.phone}</dd></div>}
              {analysis?.company.address && <div><dt>Address</dt><dd>{analysis.company.address}</dd></div>}
              {tier && <div><dt>Tier rule</dt><dd>{TIER_DEFINITION[tier]}</dd></div>}
              {target.dropReason && <div><dt>Removed</dt><dd>{target.dropReason}</dd></div>}
              {target.sourceUrl && <div><dt>Source</dt><dd><a href={target.sourceUrl} target="_blank" rel="noreferrer">{host(target.sourceUrl)} ↗</a></dd></div>}
            </dl>
          </section>}
        </aside>
      </div>}
    </main>
  </div>;
}
