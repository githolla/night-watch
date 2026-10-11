"use client";

import Link from "next/link";
import { Bell, CalendarDays, Check, ChevronRight, CircleAlert, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import { FollowupQueue } from "@/components/FollowupQueue";
import { setCardStatus } from "@/lib/card-status";
import type { HomeData } from "@/lib/home-view";
import { replyLabel } from "@/lib/reply-labels";
import type { ReplyItem } from "@/lib/replies-view";
import type { NextUpLead, SeriesDay } from "@/lib/home-stats";
import type { Owner } from "@/lib/types";

type Metric = "sent" | "replies" | "interested" | "bounced";
type Range = 7 | 14 | 30 | 90;

const RANGES: Range[] = [7, 14, 30, 90];
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "sent", label: "Sent" }, { key: "replies", label: "Replies" }, { key: "interested", label: "Interested" },
];

const sum = (days: SeriesDay[], key: Metric) => days.reduce((total, day) => total + day[key], 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayLabel = (date: string, long = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", long ? { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });


/** Sent emails as bars (first emails and follow-ups), with replies, interest or bounces drawn over them. Hover a day for its numbers. */
function ActivityChart({ days, metric }: { days: SeriesDay[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...days.map((day) => day.sent));
  const step = top <= 5 ? 1 : top <= 20 ? 5 : top <= 50 ? 10 : 20;
  const ceiling = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step).reverse();
  const shown = hover === null ? null : days[hover];
  const every = Math.ceil(days.length / 6);
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(days.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * days.length))));
  };
  return (
    <div className="hv-chart">
      <div className="hv-chart-y" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{tick}</span>)}</div>
      <div className="hv-chart-plot" onPointerMove={pick} onPointerLeave={() => setHover(null)} role="img" aria-label={`Emails sent per day over the last ${days.length} days`}>
        <div className="hv-chart-grid" aria-hidden="true">{ticks.map((tick) => <i key={tick} />)}</div>
        <div className="hv-chart-bars">
          {days.map((day, index) => {
            const followups = day.sent - day.firsts;
            const over = metric === "sent" ? 0 : day[metric];
            return (
              <div key={day.date} className={`hv-col ${hover === index ? "is-hover" : ""} ${hover !== null && hover !== index ? "is-dim" : ""}`}>
                <div className="hv-bar" style={{ height: `${(day.sent / ceiling) * 100}%` }}>
                  {metric === "sent"
                    ? <><span className="is-follow" style={{ height: `${pct(followups, day.sent)}%` }} /><span className="is-first" style={{ height: `${pct(day.firsts, day.sent)}%` }} /></>
                    : <span className={`is-${metric}`} style={{ height: `${pct(over, day.sent)}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        {shown && hover !== null && (
          <div className={`hv-tip ${hover > days.length / 2 ? "is-left" : ""}`} style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <b>{dayLabel(shown.date, true)}</b>
            <span><i className="is-first" />{count(shown.firsts, "first email", "first emails")}</span>
            <span><i className="is-follow" />{count(shown.sent - shown.firsts, "follow-up", "follow-ups")}</span>
            <span><i className="is-replies" />{count(shown.replies, "reply", "replies")}</span>
            <span><i className="is-interested" />{shown.interested} interested</span>
            {shown.bounced > 0 && <span><i className="is-bounced" />{shown.bounced} bounced</span>}
          </div>
        )}
        <div className="hv-chart-x" aria-hidden="true">
          {days.map((day, index) => <span key={day.date}>{index % every === (days.length - 1) % every ? (index === days.length - 1 ? "Today" : dayLabel(day.date)) : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

function Panel({ className, title, sub, link, side, children }: { className: string; title: string; sub?: string; link?: { href: string; label: string }; side?: ReactNode; children: ReactNode }) {
  return (
    <section className={`home-card ov-panel ${className}`} aria-label={title}>
      <div className="ov-panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{side}{link && <More href={link.href}>{link.label}</More>}</div>
      {children}
    </section>
  );
}

const More = ({ href, children }: { href: string; children: ReactNode }) => <Link className="ov-more" href={href}>{children}<ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" /></Link>;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const where = (lead: NextUpLead) =>
  lead.group === "going" ? { tone: "ok", text: lead.time ? `About ${lead.time}` : "Next window" }
  : lead.group === "later" ? { tone: "muted", text: "A later window" }
  : lead.group === "held" ? { tone: "warn", text: lead.reason ?? "Held back" }
  : lead.group === "kept" ? { tone: "muted", text: "Kept for you" }
  : { tone: lead.reason === "Not in a window yet" ? "muted" : "warn", text: lead.reason ?? "Not queued" };

/** The send queue, master and detail: pick anyone to see who they are, where they sit and open their draft. */
function NextUp({ queue, owner }: { queue: NextUpLead[]; owner: Owner }) {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [picked, setPicked] = useState<string | null>(null);
  const sectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lead of queue) counts.set(lead.industry, (counts.get(lead.industry) ?? 0) + 1);
    return [...counts.entries()].filter(([label]) => label !== "Other").sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [queue]);
  const needle = query.trim().toLowerCase();
  const shown = queue.filter((lead) => (sector === "all" || lead.industry === sector) && (!needle || `${lead.name} ${lead.company} ${lead.title}`.toLowerCase().includes(needle)));
  const lead = shown.find((item) => item.id === picked) ?? shown[0];

  if (!queue.length) return <p className="ov-step-empty">No drafts waiting. New companies and drafts arrive with each weeknight&rsquo;s list. <More href="/targets">Find companies</More></p>;

  return (
    <div className="ov-next">
      <div className="ov-next-tools">
        <div className="ov-seg" role="tablist" aria-label="Sector">
          <button type="button" role="tab" aria-selected={sector === "all"} className={sector === "all" ? "is-on" : ""} onClick={() => setSector("all")}>All <span>{queue.length}</span></button>
          {sectors.map(([label, n]) => <button key={label} type="button" role="tab" aria-selected={sector === label} className={sector === label ? "is-on" : ""} onClick={() => setSector(label)}>{label} <span>{n}</span></button>)}
        </div>
        <label className="ov-search"><Search size={15} strokeWidth={2} aria-hidden="true" /><span className="sr-only">Find a person or company</span><input type="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
      <div className="ov-next-body">
        <ul className="ov-queue" aria-label="People ready to email">
          {shown.map((item) => {
            const state = where(item);
            return (
              <li key={item.id}>
                <button type="button" className={item.id === lead?.id ? "is-on" : ""} aria-pressed={item.id === lead?.id} onClick={() => setPicked(item.id)}>
                  <span className="ov-avatar" aria-hidden="true">{initials(item.name)}</span>
                  <span className="ov-queue-who"><b>{item.name}</b><small>{item.company}</small></span>
                  <span className={`ov-dot is-only is-${state.tone}`} title={state.text}><span className="sr-only">{state.text}</span></span>
                  <ChevronRight className="ov-queue-go" size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            );
          })}
          {!shown.length && <li className="ov-queue-none">Nobody matches. <button type="button" onClick={() => { setQuery(""); setSector("all"); }}>Show everyone</button></li>}
        </ul>
        {lead && (
          <article className="ov-detail" aria-live="polite">
            <span className={`ov-dot is-${where(lead).tone}`}>{lead.position ? `Number ${lead.position} · ` : ""}{where(lead).text}</span>
            <div className="ov-detail-who">
              <span className="ov-avatar is-big" aria-hidden="true">{initials(lead.name)}</span>
              <div><h3>{lead.name}</h3><p>{[lead.title, lead.company].filter(Boolean).join(" at ")}</p></div>
            </div>
            <dl className="ov-detail-facts">
              <div><dt>Sector</dt><dd>{lead.industry}</dd></div>
              <div><dt>Role</dt><dd>{lead.role}</dd></div>
              <div><dt>Size</dt><dd>{lead.size}</dd></div>
              <div><dt>Address</dt><dd className={lead.confirmed ? "is-ok" : "is-warn"}>{lead.confirmed ? <><Check size={14} strokeWidth={2.4} aria-hidden="true" />Verified</> : <><CircleAlert size={14} strokeWidth={2.2} aria-hidden="true" />Not confirmed</>}</dd></div>
            </dl>
            {lead.subject && <p className="ov-detail-subject"><span>Subject</span>{lead.subject}</p>}
            <div className="ov-detail-actions">
              <Link className="ov-btn is-primary" href={`/outreach?list=${owner}&card=${lead.id}`}>Open draft</Link>
              <More href={`/auto-send?owner=${owner}`}>Where it sits</More>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

type Step = "replies" | "followups" | "fix" | "drafts";

const replyTone = (classification: string) => ["positive", "referral"].includes(classification) ? "ok" : classification === "objection" ? "warn" : "muted";
const ago = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

/** One reply, ready to act on: what they wrote, the next step and the buttons that settle it. */
function ReplyCard({ item, nextStep, canAct, onDone }: { item: ReplyItem; nextStep: string; canAct: boolean; onDone: (cardId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move(status: "meeting" | "archived") {
    setBusy(true);
    setError(null);
    const result = await setCardStatus(item.cardId, status);
    setBusy(false);
    if (result.ok) onDone(item.cardId); else setError(result.error);
  }
  return (
    <li className="ov-reply">
      <div className="ov-reply-head">
        <span className="ov-avatar" aria-hidden="true">{initials(item.name)}</span>
        <span className="ov-queue-who"><b>{item.name}</b><small>{[item.title, item.company].filter(Boolean).join(" · ")}</small></span>
        <span className={`ov-dot is-${replyTone(item.classification)}`}>{replyLabel(item.classification)}</span>
        <span className="ov-reply-when">{ago(item.repliedAt)}</span>
      </div>
      {item.snippet ? <blockquote className="ov-reply-text">{item.snippet}</blockquote> : <p className="ov-reply-text is-missing">Open the thread in Gmail to read their reply.</p>}
      <p className="ov-reply-next"><span>Next step</span>{nextStep}</p>
      <div className="ov-reply-actions">
        {item.gmailUrl && <a className="ov-btn is-primary" href={item.gmailUrl} target="_blank" rel="noreferrer">Reply in Gmail</a>}
        <Link className="ov-btn" href={`/brief/${item.cardId}`}>Call brief</Link>
        {canAct && <>
          <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => void move("meeting")}>Meeting booked</button>
          <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => void move("archived")}>Close</button>
        </>}
      </div>
      {error && <p className="ov-error" role="alert">{error}</p>}
    </li>
  );
}

/** The morning in order: answer replies, send the follow-ups that wait on you, fix bounced addresses, then review drafts. */
function YourDay({ data, owner, nextStep, canAct, canSend }: { data: HomeData; owner: Owner; nextStep: Record<string, string>; canAct: boolean; canSend: boolean }) {
  const [replies, setReplies] = useState(data.replies);
  const [settled, setSettled] = useState(0);
  const steps: Array<{ key: Step; label: string; count: number; done: string; todo: string }> = [
    { key: "replies", label: "Replies", count: replies.length, done: settled ? `${settled} settled` : "None waiting", todo: `${replies.length} to answer` },
    { key: "followups", label: "Follow-ups", count: data.followups.length, done: "None due", todo: `${data.followups.length} to send` },
    { key: "fix", label: "Addresses", count: data.bounces.length, done: "None bounced", todo: `${data.bounces.length} to fix` },
    { key: "drafts", label: "Drafts", count: data.queue.length, done: "None waiting", todo: `${data.queue.length} to review` },
  ];
  const first = steps.find((step) => step.count > 0 && step.key !== "drafts")?.key ?? "drafts";
  const [open, setOpen] = useState<Step>(first);
  const q = `owner=${owner}`;
  // A settled reply leaves the list; when the last one goes, move on to the next step with work in it.
  const settle = (cardId: string) => {
    const left = replies.filter((row) => row.cardId !== cardId);
    setReplies(left);
    setSettled((n) => n + 1);
    if (!left.length) setOpen(steps.find((step) => step.key !== "replies" && step.count > 0)?.key ?? "drafts");
  };

  return (
    <section className="home-card ov-panel ov-day home-needs" aria-label="Your day">
      <div className="ov-panel-head"><div><h2>Your day</h2><p>Work down the steps. Each one opens right here.</p></div></div>
      <div className="ov-steps" role="tablist" aria-label="Steps">
        {steps.map((step, index) => {
          const clear = step.count === 0;
          return (
            <button key={step.key} type="button" role="tab" data-step={step.key} aria-selected={open === step.key} className={`ov-step ${open === step.key ? "is-on" : ""} ${clear ? "is-clear" : ""}`} onClick={() => setOpen(step.key)}>
              <span className="ov-step-num" aria-hidden="true">{clear ? <Check size={14} strokeWidth={2.6} /> : index + 1}</span>
              <span className="ov-step-text"><b>{step.label}</b><small>{clear ? step.done : step.todo}</small></span>
            </button>
          );
        })}
      </div>

      <div className="ov-step-body" role="tabpanel">
        {open === "replies" && (replies.length
          ? <ul className="ov-replies">{replies.map((item) => <ReplyCard key={item.cardId} item={item} canAct={canAct} nextStep={nextStep[item.classification] ?? "Read it and reply from your Gmail thread."} onDone={settle} />)}</ul>
          : <p className="ov-step-empty">No replies need a response. New ones land here and in your inbox. <More href={`/replies?${q}`}>All replies</More></p>)}

        {open === "followups" && (data.followups.length
          ? <><p className="ov-step-hint">These came due but couldn&rsquo;t go out by themselves, usually because the address isn&rsquo;t confirmed. Open one to send, change or skip it.</p><FollowupQueue items={data.followups.map((item) => ({ ...item, canAct, canSend }))} sent={false} /></>
          : <p className="ov-step-empty">Nothing due. Follow-ups go out by themselves 3 and 10 business days after each first email. <More href={`/followups?view=upcoming&${q}`}>Coming up</More></p>)}

        {open === "fix" && (data.bounces.length
          ? <ul className="ov-prio">{data.bounces.map((bounce) => (
              <li key={bounce.personId}>
                <span className="ov-glyph is-bad" aria-hidden="true"><CircleAlert size={18} strokeWidth={2} /></span>
                <span className="ov-prio-text"><b>{bounce.name} bounced</b><small>{bounce.company}{bounce.email ? ` · ${bounce.email}` : ""}</small></span>
                <span className="ov-act"><AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /></span>
              </li>
            ))}</ul>
          : <p className="ov-step-empty">No bounced addresses in the last 30 days.</p>)}

        {open === "drafts" && <NextUp queue={data.queue} owner={owner} />}
      </div>
    </section>
  );
}

/** Overview: the day's work in order, the sending status in one line, then how it is going. */
export function HomeView({ data, owner, hello, aside, nextStep, canAct, canSend }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode; nextStep: Record<string, string>; canAct: boolean; canSend: boolean }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const [range, setRange] = useState<Range>(14);
  const [metric, setMetric] = useState<Metric>("sent");

  const current = useMemo(() => data.series.slice(-range), [data.series, range]);
  const totals = { sent: sum(current, "sent"), replies: sum(current, "replies"), interested: sum(current, "interested"), bounced: sum(current, "bounced") };
  const firsts = current.reduce((total, day) => total + day.firsts, 0);
  const last7 = data.series.slice(-7);
  const weekSent = sum(last7, "sent");
  const weekBounceRate = pct(sum(last7, "bounced"), weekSent);

  const on = Boolean(auto && !auto.plan.blocker);
  const autoState = auto?.control.paused ? "Auto-send paused" : on ? (auto?.control.skippedToday ? "Auto-send skipped today" : "Auto-send on") : "Auto-send off";
  const sendWindow = auto ? `${auto.plan.dayLabel.charAt(0).toUpperCase() + auto.plan.dayLabel.slice(1)}, ${auto.plan.windowLabel} ET` : null;
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    weekSent >= 5 && weekBounceRate >= 5 && { text: `${weekBounceRate}% of this week's emails bounced. Fix the addresses under Your day before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const todo = [
    data.replies.length && count(data.replies.length, "reply", "replies") + " to answer",
    data.followups.length && count(data.followups.length, "follow-up", "follow-ups") + " to send",
    data.bounces.length && count(data.bounces.length, "address", "addresses") + " to fix",
    data.queue.length && count(data.queue.length, "draft", "drafts") + " to review",
  ].filter((part): part is string => Boolean(part));
  const summary = todo.length ? `Today: ${todo.length > 1 ? `${todo.slice(0, -1).join(", ")} and ${todo.at(-1)}` : todo[0]}.` : "You are all caught up.";

  const kpis = [
    { label: "Emails sent", value: String(totals.sent), sub: count(totals.sent - firsts, "follow-up", "follow-ups") },
    { label: "Reply rate", value: `${pct(totals.replies, totals.sent)}%`, sub: count(totals.replies, "reply", "replies") },
    { label: "Interested", value: String(totals.interested), sub: "positive or a referral" },
    { label: "Meetings booked", value: String(data.funnel?.meetings ?? 0), sub: "on the calendar now" },
    { label: "Bounce rate", value: `${pct(totals.bounced, totals.sent)}%`, sub: count(totals.bounced, "bounce", "bounces") },
  ];
  const funnelSteps = data.funnel ? [
    { label: "Emailed", value: data.funnel.emailed },
    { label: "Replied", value: data.funnel.replied },
    { label: "Interested", value: data.funnel.interested },
    { label: "Meeting booked", value: data.funnel.meetings },
  ] : [];

  return (
    <div className="home ov">
      <header className="ov-top page-top">
        <nav className="ov-crumbs" aria-label="Where you are"><span>Workspace</span><span aria-hidden="true">/</span><b>Overview</b></nav>
        <div className="ov-top-side">
          {aside}
          <Link className={`ov-bell ${data.replies.length ? "has-dot" : ""}`} href={`/replies?${q}`} title={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"} aria-label={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "Replies"}><Bell size={19} strokeWidth={1.8} /></Link>
        </div>
      </header>

      <div className="ov-hello">
        <div>
          <h1>{hello}, {data.first}.</h1>
          <p>{summary}</p>
        </div>
        <Link className="ov-btn" href="/targets">Find companies</Link>
      </div>

      <div className="home-auto ov-status" aria-label="Sending">
        <span className={`ov-dot is-${auto?.control.paused ? "bad" : on ? "ok" : "warn"}`}>{autoState}</span>
        {sendWindow && <span>Next window <b>{sendWindow}</b></span>}
        {auto && <span><b>{auto.plan.sentToday}</b> of {auto.plan.dailyCap} sent today</span>}
        {on && auto && <span><b>{auto.plan.going}</b> going next</span>}
        <More href={`/auto-send?${q}`}>Manage</More>
      </div>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <YourDay data={data} owner={owner} nextStep={nextStep} canAct={canAct} canSend={canSend} />

      <h2 className="ov-section">How it&rsquo;s going</h2>
      <section className="ov-kpis" aria-label="Headline numbers">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="ov-kpi">
            <span className="ov-kpi-label">{kpi.label}</span>
            <span className="ov-kpi-value"><b>{kpi.value}</b></span>
            <small>{kpi.sub}</small>
          </div>
        ))}
      </section>

      <div className="ov-grid is-main">
        <Panel className="home-week ov-activity" title="Outreach activity" side={
          <label className="ov-range">
            <CalendarDays size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">Period</span>
            <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>
              {RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}
            </select>
          </label>
        }>
          <div className="ov-seg is-small" role="tablist" aria-label="Show on the chart">
            {METRICS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} className={metric === item.key ? "is-on" : ""} onClick={() => setMetric(item.key)}>{item.label}</button>)}
          </div>
          {data.series.length ? <ActivityChart days={current} metric={metric} /> : <p className="home-empty">Sent emails show here once the first ones go out.</p>}
        </Panel>

        <Panel className="ov-pipeline" title="Conversation pipeline" sub="First-touch contacts · last 90 days" link={{ href: "/pipeline", label: "Open" }}>
          <ol className="hv-steps">
            {funnelSteps.map((step) => (
              <li key={step.label}>
                <div className="hv-step-top"><span>{step.label}</span><b>{step.value}</b></div>
                <div className="hv-step-bar"><span style={{ width: `${Math.max(pct(step.value, Math.max(1, funnelSteps[0].value)), step.value ? 3 : 0)}%` }} /></div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
