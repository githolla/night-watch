"use client";

import Link from "next/link";
import { ArrowRight, Ban, Bell, Building2, CalendarDays, CircleCheck, Clock3, FileText, Inbox, Mail, Reply, TriangleAlert, Users, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import type { HomeData } from "@/lib/home-view";
import type { SeriesDay } from "@/lib/home-stats";
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
      <div className="ov-panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{side}{link && <Link href={link.href}>{link.label} &rarr;</Link>}</div>
      {children}
    </section>
  );
}

type Priority = { key: string; icon: LucideIcon; tone: "bad" | "warn" | "ok" | "muted"; title: ReactNode; sub: ReactNode; status?: string; action: ReactNode };

const Go = ({ href, children }: { href: string; children: ReactNode }) => <Link className="ov-go" href={href}>{children}<ArrowRight size={16} strokeWidth={2} aria-hidden="true" /></Link>;

/** Overview: the next move, what needs you today, and how sending is going, each one click from where it is handled. */
export function HomeView({ data, owner, hello, aside }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode }) {
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
  const autoState = auto?.control.paused ? "Auto-send paused" : on ? (auto?.control.skippedToday ? "Skipped today" : "Auto-send on") : "Auto-send off";
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    weekSent >= 5 && weekBounceRate >= 5 && { text: `${weekBounceRate}% of this week's emails bounced. Fix the addresses under Today's priorities before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const leads = data.list?.leads ?? [];
  const unconfirmed = auto?.unconfirmedQueued ?? 0;

  const kpis: Array<{ icon: LucideIcon; tone: string; label: string; value: string; sub: string }> = [
    { icon: Mail, tone: "ok", label: "Emails sent", value: String(totals.sent), sub: count(totals.sent - firsts, "follow-up", "follow-ups") },
    { icon: Reply, tone: "ok", label: "Reply rate", value: `${pct(totals.replies, totals.sent)}%`, sub: count(totals.replies, "reply", "replies") },
    { icon: Users, tone: "ok", label: "Interested", value: String(totals.interested), sub: "positive or a referral" },
    { icon: CalendarDays, tone: "ok", label: "Meetings booked", value: String(data.funnel?.meetings ?? 0), sub: "on the calendar now" },
    { icon: Ban, tone: "warn", label: "Bounce rate", value: `${pct(totals.bounced, totals.sent)}%`, sub: count(totals.bounced, "bounce", "bounces") },
  ];

  const priorities: Priority[] = [
    ...data.bounces.slice(0, 3).map((bounce) => ({ key: `b-${bounce.personId}`, icon: TriangleAlert, tone: "bad" as const, title: <>{bounce.name} bounced</>, sub: <>{bounce.company}{bounce.email ? ` · ${bounce.email}` : ""}</>, status: "Bounced", action: <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /> })),
    ...(data.replies.length ? [{ key: "replies", icon: Inbox, tone: "ok" as const, title: <>{count(data.replies.length, "reply", "replies")} waiting</>, sub: <>Answer from your Gmail thread.</>, action: <Go href={`/replies?${q}`}>Open</Go> }] : []),
    { key: "drafts", icon: FileText, tone: data.drafts ? "ok" : "muted", title: <>{data.drafts ? `${count(data.drafts, "draft", "drafts")} ready` : "No drafts waiting"}</>, sub: <>{data.drafts ? "Review your personalized emails." : "New ones arrive with each weeknight's list."}</>, action: <Go href={`/drafts?${q}`}>Review</Go> },
    ...(unconfirmed ? [{ key: "unconfirmed", icon: TriangleAlert, tone: "warn" as const, title: <>{count(unconfirmed, "contact", "contacts")} to verify</>, sub: <>Verify contacts before sending.</>, action: <Go href={`/auto-send?${q}`}>Verify</Go> }] : []),
    { key: "auto", icon: Clock3, tone: auto?.control.paused ? "bad" : on ? "ok" : "muted", title: <>{autoState}</>, sub: <>{on ? `${count(auto?.plan.going ?? 0, "email", "emails")} in the next window.` : "Set a schedule to start sending."}</>, action: <Go href={`/auto-send?${q}`}>Manage</Go> },
  ];

  const funnelSteps = data.funnel ? [
    { label: "Emailed", value: data.funnel.emailed },
    { label: "Replied", value: data.funnel.replied },
    { label: "Interested", value: data.funnel.interested },
    { label: "Meeting booked", value: data.funnel.meetings },
  ] : [];
  const reply = data.replies[0];

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
        <p>{hello}, {data.first}.</p>
        <h1>Turn prospects into conversations.</h1>
      </div>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <div className="ov-grid is-hero">
        <section className={`ov-hero ${leads.length ? "has-leads" : ""}`} aria-label="Your next move">
          <div className="ov-hero-copy">
            <span className="ov-eyebrow">Your next move</span>
            {data.drafts
              ? <h2>{count(data.drafts, "lead", "leads")} ready.<br />Make your next introduction.</h2>
              : <h2>You are all caught up.<br />Find your next companies.</h2>}
            <p>{data.drafts ? "Verified contacts. Personalized drafts. Ready for your review." : "New companies and drafts arrive with each weeknight's list."}</p>
            <div className="ov-hero-actions">
              {data.drafts ? <Link className="ov-hero-primary" href={`/drafts?${q}`}>Review outreach<ArrowRight size={17} strokeWidth={2} aria-hidden="true" /></Link> : null}
              <Link className={data.drafts ? "ov-hero-ghost" : "ov-hero-primary"} href="/targets">Find companies<ArrowRight size={17} strokeWidth={2} aria-hidden="true" /></Link>
            </div>
          </div>
          {leads.length > 0 && (
            <ul className="ov-leads" aria-label="Ready leads">
              {leads.map((lead) => (
                <li key={lead.company}>
                  <span className="ov-lead-icon" aria-hidden="true"><Building2 size={20} strokeWidth={1.7} /></span>
                  <span className="ov-lead-text">
                    <b>{lead.company}</b>
                    <small className={lead.confirmed ? "is-ok" : ""}>{lead.confirmed ? <CircleCheck size={14} strokeWidth={2} aria-hidden="true" /> : <Clock3 size={14} strokeWidth={2} aria-hidden="true" />}<span>{lead.sector === "Other" ? "" : `${lead.sector} · `}{lead.confirmed ? "Verified contact" : "Checking address"}</span></small>
                  </span>
                  <span className="ov-pill">Draft ready</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Panel className="home-needs ov-priorities" title="Today's priorities">
          <ul className="ov-prio">
            {priorities.map((row) => (
              <li key={row.key}>
                <span className={`ov-icon is-${row.tone}`} aria-hidden="true"><row.icon size={19} strokeWidth={1.8} /></span>
                <span className="ov-prio-text"><b>{row.title}</b><small>{row.sub}</small></span>
                {row.status && <span className={`ov-status is-${row.tone}`}>{row.status}</span>}
                <span className="ov-act">{row.action}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <section className="ov-kpis" aria-label="Headline numbers">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="ov-kpi">
            <span className={`ov-icon is-${kpi.tone}`} aria-hidden="true"><kpi.icon size={19} strokeWidth={1.8} /></span>
            <span className="ov-kpi-text">
              <span className="ov-kpi-label">{kpi.label}</span>
              <span className="ov-kpi-value"><b>{kpi.value}</b></span>
              <small>{kpi.sub}</small>
            </span>
          </div>
        ))}
      </section>

      <div className="ov-grid is-main">
        <Panel className="home-week ov-activity" title="Outreach activity" side={
          <label className="ov-range">
            <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">Period</span>
            <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>
              {RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}
            </select>
          </label>
        }>
          <div className="ov-tabs" role="tablist" aria-label="Show on the chart">
            {METRICS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} className={metric === item.key ? "is-on" : ""} onClick={() => setMetric(item.key)}>{item.label}</button>)}
          </div>
          {data.series.length ? <ActivityChart days={current} metric={metric} /> : <p className="home-empty">Sent emails show here once the first ones go out.</p>}
        </Panel>

        <Panel className="ov-pipeline" title="Conversation pipeline" sub="First-touch contacts · Last 90 days" link={{ href: "/pipeline", label: "Open" }}>
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

      <div className="ov-grid is-even">
        <Panel className="home-inbox ov-strip" title="Inbox">
          <div className="ov-strip-row">
            <span className="ov-icon is-big is-muted" aria-hidden="true"><Mail size={22} strokeWidth={1.7} /></span>
            <span className="ov-prio-text">
              <b>{data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"}</b>
              <small>{reply ? `Newest: ${reply.name}${reply.company ? `, ${reply.company}` : ""}` : "New replies will appear here."}</small>
            </span>
            <span className="ov-act"><Go href={`/replies?${q}`}>View inbox</Go></span>
          </div>
        </Panel>

        <Panel className={`home-auto ov-strip ${on ? "is-on" : ""}`} title="Next sending window" side={<span className={`ov-badge ${on ? "is-ok" : "is-warn"}`}><Clock3 size={14} strokeWidth={2} aria-hidden="true" />{autoState}</span>}>
          <div className="ov-strip-row">
            <span className="ov-icon is-big is-ok" aria-hidden="true"><CalendarDays size={22} strokeWidth={1.7} /></span>
            {auto
              ? <span className="ov-prio-text"><b>{auto.plan.dayLabel.charAt(0).toUpperCase() + auto.plan.dayLabel.slice(1)} · {auto.plan.windowLabel} ET</b><small>{on ? `${count(auto.plan.going, "email", "emails")} going out · ${auto.plan.sentToday} of ${auto.plan.dailyCap} sent today` : `${count(data.drafts, "email", "emails")} ready`}</small></span>
              : <span className="ov-prio-text"><b>Not known just now</b><small>Auto-send could not be read.</small></span>}
            <span className="ov-act"><Go href={`/auto-send?${q}`}>Manage</Go></span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
