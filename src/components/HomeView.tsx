"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import type { HomeData } from "@/lib/home-view";
import type { SeriesDay } from "@/lib/home-stats";
import { replyLabel } from "@/lib/reply-labels";
import type { Owner } from "@/lib/types";

type Metric = "sent" | "replies" | "interested" | "bounced";
type Range = 7 | 14 | 30 | 90;
type MixKey = "industry" | "role" | "size";

const RANGES: Range[] = [7, 14, 30, 90];
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "sent", label: "Sent" }, { key: "replies", label: "Replies" }, { key: "interested", label: "Interested" }, { key: "bounced", label: "Bounced" },
];
const MIX: Array<[MixKey, string]> = [["industry", "Industry"], ["role", "Role"], ["size", "Company size"]];
const EVENT: Record<string, { label: string; tone: string }> = {
  sent: { label: "Emailed", tone: "sent" }, replied: { label: "Replied", tone: "reply" }, interested: { label: "Interested", tone: "good" }, bounced: { label: "Bounced", tone: "bad" },
};

const sum = (days: SeriesDay[], key: Metric) => days.reduce((total, day) => total + day[key], 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "?";
const dayLabel = (date: string, long = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", long ? { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });
function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : days < 7 ? `${days}d ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

/** A small line of one number across the range, for a headline tile. */
function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null;
  const top = Math.max(1, ...values);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${30 - (value / top) * 26}`).join(" ");
  return (
    <svg className={`hv-spark is-${tone}`} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,32 ${points} 100,32`} />
      <polyline points={points} />
    </svg>
  );
}

/** Change against the period before, when there is one to compare. */
function Delta({ now, before, goodWhenDown = false, show }: { now: number; before: number; goodWhenDown?: boolean; show: boolean }) {
  if (!show || (!now && !before)) return <em className="hv-delta">&nbsp;</em>;
  if (!before) return <em className="hv-delta is-up">new</em>;
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return <em className="hv-delta">no change</em>;
  const good = goodWhenDown ? change < 0 : change > 0;
  return <em className={`hv-delta ${good ? "is-up" : "is-down"}`}>{change > 0 ? "▲" : "▼"} {Math.abs(change)}%</em>;
}

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

function Card({ className, title, count: badge, link, children }: { className: string; title: string; count?: number; link?: { href: string; label: string }; children: ReactNode }) {
  return (
    <section className={`home-card ${className}`} aria-label={title}>
      <div className="home-card-head"><h2>{title}{badge !== undefined && <span>{badge}</span>}</h2>{link && <Link href={link.href}>{link.label} &rarr;</Link>}</div>
      {children}
    </section>
  );
}

/** Home: the day at a glance, how sending is going, and the people behind it, each one click from where it is handled. */
export function HomeView({ data, owner, hello, aside }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const [range, setRange] = useState<Range>(14);
  const [metric, setMetric] = useState<Metric>("sent");
  const [mixKey, setMixKey] = useState<MixKey>("industry");
  const [mixView, setMixView] = useState<"results" | "queue">("results");
  const [now] = useState(() => Date.now());

  const current = useMemo(() => data.series.slice(-range), [data.series, range]);
  const previous = useMemo(() => data.series.slice(-range * 2, -range), [data.series, range]);
  const comparable = previous.length === range;
  const totals = { sent: sum(current, "sent"), replies: sum(current, "replies"), interested: sum(current, "interested"), bounced: sum(current, "bounced") };
  const before = { sent: sum(previous, "sent"), replies: sum(previous, "replies"), interested: sum(previous, "interested"), bounced: sum(previous, "bounced") };
  const replyRate = pct(totals.replies, totals.sent);
  const bounceRate = pct(totals.bounced, totals.sent);
  const weekBounceRate = data.week ? pct(data.week.daily.slice(-7).reduce((total, day) => total + day.bounced, 0), data.week.daily.slice(-7).reduce((total, day) => total + day.sent, 0)) : 0;
  const weekSent = data.week ? data.week.daily.slice(-7).reduce((total, day) => total + day.sent, 0) : 0;

  const on = Boolean(auto && !auto.plan.blocker);
  const needs = data.bounces.length + (auto?.unconfirmedQueued ? 1 : 0);
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    weekSent >= 5 && weekBounceRate >= 5 && { text: `${weekBounceRate}% of this week's emails bounced. Fix the addresses below before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const summary = [
    data.replies.length ? count(data.replies.length, "reply waiting", "replies waiting") : "no replies waiting",
    auto ? `${count(auto.plan.going, "email", "emails")} ${on ? "going out" : "ready for"} ${auto.plan.dayLabel}` : null,
    needs ? `${count(needs, "thing needs", "things need")} you` : null,
  ].filter(Boolean).join(" · ");

  const kpis: Array<{ key: Metric | "rate" | "meetings"; label: string; value: string; sub: string; spark: number[]; tone: string; delta: ReactNode; metric?: Metric }> = [
    { key: "sent", metric: "sent", label: "Emails sent", value: String(totals.sent), sub: `${sum(current, "sent") - current.reduce((total, day) => total + day.firsts, 0)} were follow-ups`, spark: current.map((day) => day.sent), tone: "sent", delta: <Delta now={totals.sent} before={before.sent} show={comparable} /> },
    { key: "rate", metric: "replies", label: "Reply rate", value: `${replyRate}%`, sub: count(totals.replies, "reply", "replies"), spark: current.map((day) => day.replies), tone: "reply", delta: <Delta now={replyRate} before={pct(before.replies, before.sent)} show={comparable && before.sent > 0} /> },
    { key: "interested", metric: "interested", label: "Interested", value: String(totals.interested), sub: "positive or a referral", spark: current.map((day) => day.interested), tone: "good", delta: <Delta now={totals.interested} before={before.interested} show={comparable} /> },
    { key: "meetings", label: "Meetings booked", value: String(data.funnel?.meetings ?? 0), sub: "on the calendar now", spark: [], tone: "good", delta: <em className="hv-delta">&nbsp;</em> },
    { key: "bounced", metric: "bounced", label: "Bounce rate", value: `${bounceRate}%`, sub: count(totals.bounced, "bounce", "bounces"), spark: current.map((day) => day.bounced), tone: bounceRate >= 5 ? "bad" : "muted", delta: <Delta now={totals.bounced} before={before.bounced} goodWhenDown show={comparable} /> },
  ];

  const mixRows = mixView === "results" ? data.mix[mixKey] : data.queue[mixKey].map((row) => ({ label: row.label, sent: row.count, replies: 0, interested: 0, rate: 0 }));
  const mixTop = Math.max(1, ...mixRows.map((row) => row.sent));
  const bestRate = data.mix[mixKey].filter((row) => row.sent >= 5).sort((a, b) => b.rate - a.rate)[0];
  const funnelSteps = data.funnel ? [
    { label: "Emailed", value: data.funnel.emailed },
    { label: "Replied", value: data.funnel.replied },
    { label: "Interested", value: data.funnel.interested },
    { label: "Meeting", value: data.funnel.meetings },
  ] : [];
  const cap = auto?.plan.dailyCap ?? 0;
  const sentToday = auto?.plan.sentToday ?? 0;

  return (
    <div className="home">
      <header className="home-head page-top">
        <div>
          <h1>{hello}, {data.first}.</h1>
          <p>Here is your day in Night Watch: {summary}.</p>
        </div>
        <div className="home-head-side">
          {aside}
        </div>
      </header>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <div className="hv-kpis" role="group" aria-label="Headline numbers">
        {kpis.map((kpi) => (
          <button key={kpi.key} type="button" className={`hv-kpi ${kpi.metric && kpi.metric === metric ? "is-on" : ""}`} disabled={!kpi.metric} aria-pressed={kpi.metric ? kpi.metric === metric : undefined} onClick={() => kpi.metric && setMetric(kpi.metric)} title={kpi.metric ? `Show ${kpi.label.toLowerCase()} on the chart` : undefined}>
            <span className="hv-kpi-label">{kpi.label}</span>
            <span className="hv-kpi-value"><b>{kpi.value}</b>{kpi.delta}</span>
            <small>{kpi.sub}</small>
            <Sparkline values={kpi.spark} tone={kpi.tone} />
          </button>
        ))}
      </div>

      <div className="hv-main">
        <section className="home-card home-week hv-activity" aria-label="Your week">
          <div className="home-card-head">
            <h2>Your week{range !== 7 ? <small> and the last {range} days</small> : null}</h2>
            <div className="hv-ranges" role="tablist" aria-label="Range">
              {RANGES.map((value) => <button key={value} type="button" role="tab" aria-selected={range === value} className={range === value ? "is-on" : ""} onClick={() => setRange(value)}>{value}d</button>)}
            </div>
          </div>
          <div className="hv-legend" role="group" aria-label="Show on the chart">
            {METRICS.map((item) => <button key={item.key} type="button" aria-pressed={metric === item.key} className={`is-${item.key} ${metric === item.key ? "is-on" : ""}`} onClick={() => setMetric(item.key)}><i />{item.label}</button>)}
            <Link href={`/drafts/sent?${q}&days=${Math.min(range, 30)}`}>What was sent &rarr;</Link>
          </div>
          {data.series.length ? <ActivityChart days={current} metric={metric} /> : <p className="home-empty">Sent emails show here once the first ones go out.</p>}
        </section>

        <section className="home-card hv-funnel" aria-label="From first email to meeting">
          <div className="home-card-head"><h2>From email to meeting</h2><Link href="/pipeline">Pipeline &rarr;</Link></div>
          <p className="home-sub">Everyone you first emailed in the last 90 days.</p>
          <ol className="hv-steps">
            {funnelSteps.map((stepItem, index) => {
              const width = pct(stepItem.value, Math.max(1, funnelSteps[0].value));
              const rate = index ? pct(stepItem.value, funnelSteps[index - 1].value) : null;
              return (
                <li key={stepItem.label}>
                  <div className="hv-step-top"><span>{stepItem.label}</span><b>{stepItem.value}</b></div>
                  <div className="hv-step-bar"><span style={{ width: `${Math.max(width, stepItem.value ? 3 : 0)}%` }} /></div>
                  {rate !== null && rate <= 100 && <small>{rate}% of the step before</small>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <div className="hv-row">
        <Card className="home-replies" title="Replies waiting" count={data.replies.length} link={{ href: `/replies?${q}`, label: "All replies" }}>
          {data.replies.length === 0
            ? <p className="home-empty">No replies waiting. When someone writes back, they show up here and in your inbox.</p>
            : <ul className="hv-leads">{data.replies.slice(0, 5).map((reply) => (
                <li key={reply.cardId} className={`is-${reply.classification}`}>
                  <span className="hv-avatar" aria-hidden="true">{initials(reply.name)}</span>
                  <span className="hv-lead-who"><b>{reply.name}</b><small>{reply.title ? `${reply.title}, ` : ""}{reply.company}</small></span>
                  <span className="hv-lead-meta"><span className={`home-read is-${reply.classification}`}>{replyLabel(reply.classification)}</span><small>{ago(reply.repliedAt, now)}</small></span>
                  <Link className="btn" href={`/brief/${reply.cardId}`}>Call brief</Link>
                </li>
              ))}</ul>}
          {data.meetings.length > 0 && (
            <div className="hv-meetings">
              <h3>Meetings booked</h3>
              <ul>{data.meetings.slice(0, 3).map((meeting) => <li key={meeting.cardId}><span className="hv-avatar is-meeting" aria-hidden="true">{initials(meeting.name)}</span><span className="hv-lead-who"><b>{meeting.name}</b><small>{meeting.company}</small></span><Link href={`/brief/${meeting.cardId}`}>Brief</Link></li>)}</ul>
            </div>
          )}
        </Card>

        <Card className={`home-auto ${on ? "is-on" : ""}`} title="Auto-send" link={{ href: `/auto-send?${q}`, label: "Open" }}>
          {!auto
            ? <p className="home-empty">Auto-send could not be read just now.</p>
            : <>
                <div className="hv-auto-top">
                  <div className="hv-ring" style={{ ["--fill" as string]: `${pct(sentToday, Math.max(1, cap))}%` }} role="img" aria-label={`Sent today: ${sentToday} of ${cap}`}><b>{sentToday}</b><small>of {cap} today</small></div>
                  <div>
                    <p className="home-big"><b>{auto.plan.going}</b> {auto.plan.going === 1 ? "email" : "emails"} {on ? "go out" : "would go out"} {auto.plan.dayLabel}</p>
                    <p className="home-sub">{on ? (auto.control.skippedToday ? "On, but skipped today." : `On · ${auto.plan.windowLabel} Eastern`) : auto.plan.blocker}{auto.plan.later ? ` · ${auto.plan.later} more after that` : ""}</p>
                    {data.queue.total > 0 && <p className="home-sub">{data.queue.confirmed} of {data.queue.total} waiting have a confirmed address</p>}
                  </div>
                </div>
                {data.upNext.length > 0 && (
                  <ol className="hv-next">
                    {data.upNext.slice(0, 5).map((lead) => (
                      <li key={lead.id}>
                        <time>{lead.group === "going" && lead.time ? lead.time : "Later"}</time>
                        <span className="hv-lead-who"><b>{lead.name}</b><small>{lead.title ? `${lead.title}, ` : ""}{lead.company}</small><small className="hv-tags"><span>{lead.industry}</span><span>{lead.size}</span></small></span>
                        <span className={`hv-addr ${lead.confirmed ? "is-ok" : ""}`} title={lead.confirmed ? "Address confirmed" : "Address not confirmed yet"}>{lead.confirmed ? "Confirmed" : "Unconfirmed"}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </>}
        </Card>

        <div className="hv-stack">
          <Card className="home-needs" title="Needs you" count={needs}>
            {needs === 0
              ? <p className="home-empty">Nothing needs you right now.</p>
              : <ul className="home-list">
                  {data.bounces.slice(0, 4).map((bounce) => (
                    <li key={bounce.personId}>
                      <span className="home-read is-bounced">Bounced</span>
                      <span className="home-who"><b>{bounce.name}</b><small>{bounce.company} · {bounce.email}</small></span>
                      <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" />
                    </li>
                  ))}
                  {Boolean(auto?.unconfirmedQueued) && (
                    <li>
                      <span className="home-read is-unconfirmed">Check</span>
                      <span className="home-who"><b>{count(auto!.unconfirmedQueued, "waiting email has", "waiting emails have")} an unconfirmed address</b><small>Night Watch looks for the right ones every 20 minutes. Fix any you know.</small></span>
                      <Link className="btn" href={`/auto-send?${q}`}>Review</Link>
                    </li>
                  )}
                </ul>}
          </Card>
          <Card className="home-newlist" title="Newest list" link={{ href: `/outreach?list=${owner}`, label: "Reach-out list" }}>
            {!data.list
              ? <p className="home-empty">No new list in the last few days. A fresh one is built each weeknight.</p>
              : <>
                  <p className="home-big"><b>{data.list.companies}</b> companies · {dayLabel(data.list.date)}</p>
                  <div className="hv-confirm"><span style={{ width: `${pct(data.list.confirmed, data.list.companies)}%` }} /></div>
                  <p className="home-sub">{data.list.confirmed} of {data.list.companies} addresses confirmed</p>
                  <p className="home-tags">{data.list.sectors.slice(0, 5).map((sector) => <span key={sector.label}>{sector.label} {sector.count}</span>)}</p>
                </>}
          </Card>
        </div>
      </div>

      <div className="hv-row is-two">
        <section className="home-card hv-mix" aria-label="Who you reach and who replies">
          <div className="home-card-head">
            <h2>{mixView === "results" ? "Who replies" : "Who is next"}</h2>
            <div className="hv-ranges" role="tablist" aria-label="View">
              <button type="button" role="tab" aria-selected={mixView === "results"} className={mixView === "results" ? "is-on" : ""} onClick={() => setMixView("results")}>Last 90 days</button>
              <button type="button" role="tab" aria-selected={mixView === "queue"} className={mixView === "queue" ? "is-on" : ""} onClick={() => setMixView("queue")}>Waiting to send</button>
            </div>
          </div>
          <div className="hv-legend" role="group" aria-label="Group by">
            {MIX.map(([key, label]) => <button key={key} type="button" aria-pressed={mixKey === key} className={mixKey === key ? "is-on" : ""} onClick={() => setMixKey(key)}>{label}</button>)}
          </div>
          {mixRows.length === 0
            ? <p className="home-empty">{mixView === "results" ? "Once first emails go out, this shows who they went to and who wrote back." : "Nothing is waiting to send."}</p>
            : <ul className="hv-bars">
                {mixRows.slice(0, 7).map((row) => (
                  <li key={row.label} title={mixView === "results" ? `${row.label}: ${row.sent} emailed, ${row.replies} replied (${row.rate}%), ${row.interested} interested` : `${row.label}: ${row.sent} waiting`}>
                    <span className="hv-bar-label">{row.label}</span>
                    <span className="hv-bar-track"><span className="is-sent" style={{ width: `${(row.sent / mixTop) * 100}%` }} />{mixView === "results" && <span className="is-replies" style={{ width: `${(row.replies / mixTop) * 100}%` }} />}</span>
                    <span className="hv-bar-num">{row.sent}{mixView === "results" && <small>{row.rate}% replied</small>}</span>
                  </li>
                ))}
              </ul>}
          {mixView === "results" && bestRate && bestRate.rate > 0 && <p className="hv-insight">Best so far: <b>{bestRate.label}</b> replies {bestRate.rate}% of the time ({bestRate.replies} of {bestRate.sent}).</p>}
        </section>

        <section className="home-card hv-feed" aria-label="Recent activity">
          <div className="home-card-head"><h2>Recent activity</h2><Link href="/activity">History &rarr;</Link></div>
          {data.activity.length === 0
            ? <p className="home-empty">Sends, replies and bounces show here as they happen.</p>
            : <ol className="hv-events">
                {data.activity.slice(0, 9).map((event, index) => (
                  <li key={`${event.cardId}-${event.kind}-${index}`} className={`is-${EVENT[event.kind].tone}`}>
                    <i aria-hidden="true" />
                    <span><b>{EVENT[event.kind].label === "Emailed" && event.followup ? "Follow-up to" : EVENT[event.kind].label}</b> {event.kind === "sent" ? "" : "· "}{event.name}<small>{event.company}</small></span>
                    <time>{ago(event.at, now)}</time>
                  </li>
                ))}
              </ol>}
        </section>
      </div>
    </div>
  );
}
