"use client";

import Link from "next/link";
import { Bell, CalendarDays } from "lucide-react";
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

function Panel({ className, title, sub, link, children }: { className: string; title: string; sub?: string; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className={`home-card ov-panel ${className}`} aria-label={title}>
      <div className="ov-panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{link && <Link href={link.href}>{link.label} &rarr;</Link>}</div>
      {children}
    </section>
  );
}

type Action = { key: string; item: ReactNode; status: string; tone: "bad" | "warn" | "ok" | "muted"; action: ReactNode };

/** Overview: the day at a glance, how sending is going, and the people behind it, each one click from where it is handled. */
export function HomeView({ data, owner, hello, aside }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const [range, setRange] = useState<Range>(14);
  const [metric, setMetric] = useState<Metric>("sent");

  const current = useMemo(() => data.series.slice(-range), [data.series, range]);
  const totals = { sent: sum(current, "sent"), replies: sum(current, "replies"), interested: sum(current, "interested"), bounced: sum(current, "bounced") };
  const firsts = current.reduce((total, day) => total + day.firsts, 0);
  const replyRate = pct(totals.replies, totals.sent);
  const bounceRate = pct(totals.bounced, totals.sent);
  const last7 = data.series.slice(-7);
  const weekSent = sum(last7, "sent");
  const weekBounceRate = pct(sum(last7, "bounced"), weekSent);

  const on = Boolean(auto && !auto.plan.blocker);
  const cap = auto?.plan.dailyCap ?? 0;
  const sentToday = auto?.plan.sentToday ?? 0;
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    weekSent >= 5 && weekBounceRate >= 5 && { text: `${weekBounceRate}% of this week's emails bounced. Fix the addresses below before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const banner = data.replies.length
    ? { text: `${count(data.replies.length, "reply is", "replies are")} waiting for you`, sub: "Answer from your Gmail thread; the call brief has what you need.", href: `/replies?${q}`, action: "Open replies" }
    : data.drafts
    ? { text: `${count(data.drafts, "draft", "drafts")} ready for review`, sub: on ? "Auto-send sends them each weekday morning; read any first." : "Read them, fix any, then send or turn on auto-send.", href: `/drafts?${q}`, action: "Review drafts" }
    : { text: "You are all caught up", sub: "New companies arrive with each weeknight's list.", href: "/targets", action: "Discover companies" };

  const kpis = [
    { label: "Emails sent", value: String(totals.sent), sub: count(totals.sent - firsts, "follow-up", "follow-ups") },
    { label: "Reply rate", value: `${replyRate}%`, sub: count(totals.replies, "reply", "replies") },
    { label: "Interested", value: String(totals.interested), sub: "positive or a referral" },
    { label: "Meetings booked", value: String(data.funnel?.meetings ?? 0), sub: "on the calendar now" },
    { label: "Bounce rate", value: `${bounceRate}%`, sub: count(totals.bounced, "bounce", "bounces") },
  ];

  const actions: Action[] = [
    ...data.bounces.slice(0, 4).map((bounce) => ({ key: `b-${bounce.personId}`, item: <><b>{bounce.name}</b> bounced<small>{bounce.company} · {bounce.email}</small></>, status: "Bounced", tone: "bad" as const, action: <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /> })),
    ...(data.replies.length ? [{ key: "replies", item: <>{count(data.replies.length, "reply", "replies")} waiting</>, status: "Needs you", tone: "warn" as const, action: <Link href={`/replies?${q}`}>Open replies &rarr;</Link> }] : []),
    ...(auto?.unconfirmedQueued ? [{ key: "unconfirmed", item: <>{count(auto.unconfirmedQueued, "unconfirmed address", "unconfirmed addresses")}<small>Night Watch keeps looking every 20 minutes</small></>, status: "Needs checking", tone: "warn" as const, action: <Link href={`/auto-send?${q}`}>Review &rarr;</Link> }] : []),
    { key: "drafts", item: <>{count(data.drafts, "outreach draft", "outreach drafts")}</>, status: data.drafts ? "Ready" : "None waiting", tone: data.drafts ? "ok" : "muted", action: <Link href={`/drafts?${q}`}>Open drafts &rarr;</Link> },
    { key: "auto", item: <>Auto-send</>, status: auto?.control.paused ? "Paused" : on ? (auto?.control.skippedToday ? "Skipped today" : "On") : "Off", tone: auto?.control.paused ? "bad" : on ? "ok" : "muted", action: <Link href={`/auto-send?${q}`}>Configure &rarr;</Link> },
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

      <div className="ov-title">
        <div>
          <h1>Overview</h1>
          <p>{hello}, {data.first}. Here&rsquo;s your outreach at a glance.</p>
        </div>
        <label className="ov-range">
          <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
          <span className="sr-only">Period</span>
          <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>
            {RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}
          </select>
        </label>
      </div>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <section className="ov-banner" aria-label="Next step">
        <h2>{banner.text}</h2>
        <Link className="btn primary" href={banner.href}>{banner.action}</Link>
      </section>

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
        <Panel className="home-week ov-activity" title="Outreach activity" link={{ href: `/drafts/sent?${q}&days=${Math.min(range, 30)}`, label: "What was sent" }}>
          <div className="ov-tabs" role="tablist" aria-label="Show on the chart">
            {METRICS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} className={metric === item.key ? "is-on" : ""} onClick={() => setMetric(item.key)}>{item.label}</button>)}
          </div>
          {data.series.length ? <ActivityChart days={current} metric={metric} /> : <p className="home-empty">Sent emails show here once the first ones go out.</p>}
        </Panel>

        <Panel className="ov-pipeline" title="Pipeline" sub="First emails · last 90 days" link={{ href: "/pipeline", label: "Open" }}>
          <ol className="hv-steps">
            {funnelSteps.map((step) => {
              return (
                <li key={step.label}>
                  <div className="hv-step-top"><span>{step.label}</span><b>{step.value}</b></div>
                  <div className="hv-step-bar"><span style={{ width: `${Math.max(pct(step.value, Math.max(1, funnelSteps[0].value)), step.value ? 3 : 0)}%` }} /></div>
                </li>
              );
            })}
          </ol>
        </Panel>
      </div>

      <div className="ov-grid is-actions">
        <Panel className="home-needs ov-actions" title="Action items">
          <div className="ov-table-head" aria-hidden="true"><span>Item</span><span>Status</span><span>Action</span></div>
          <ul className="ov-table">
            {actions.map((row) => (
              <li key={row.key}>
                <span className="ov-item">{row.item}</span>
                <span className={`ov-status is-${row.tone}`}>{row.status}</span>
                <span className="ov-act">{row.action}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className={`home-auto ov-sending ${on ? "is-on" : ""}`} title="Sending & replies" link={{ href: `/auto-send?${q}`, label: "Auto-send" }}>
          {!auto
            ? <p className="home-empty">Auto-send could not be read just now.</p>
            : <dl className="ov-facts">
                <div><dt>Next window</dt><dd>{auto.plan.dayLabel}, {auto.plan.windowLabel} ET</dd></div>
                <div><dt>Auto-send</dt><dd>{auto.control.paused ? "Paused" : on ? `On · ${count(auto.plan.going, "email", "emails")} next` : "Off"}</dd></div>
                <div><dt>Sent today</dt><dd>{sentToday} of {cap}</dd></div>
                <div><dt>Replies waiting</dt><dd>{data.replies.length}</dd></div>
              </dl>}
        </Panel>
      </div>
    </div>
  );
}
