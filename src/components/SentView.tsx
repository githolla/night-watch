"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SentRow, SentStats } from "@/lib/sent-stats";

type Kind = "industry" | "role" | "size";
type Show = "all" | "replied" | "interested" | "bounced" | "followups";
const ZONE = "America/New_York";
const PERIODS: Array<[number, string]> = [[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"]];
const OUTCOME_LABEL: Record<SentRow["outcome"], string> = { interested: "Interested", replied: "Replied", bounced: "Bounced", "out of office": "Out of office", sent: "Sent" };

const when = (iso: string) => {
  const date = new Date(iso);
  const day = (value: Date) => value.toLocaleDateString("en-US", { timeZone: ZONE });
  const time = date.toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" }).replace(" ", "").toLowerCase();
  if (day(date) === day(new Date())) return `Today ${time}`;
  return `${date.toLocaleDateString("en-US", { timeZone: ZONE, month: "short", day: "numeric" })} ${time}`;
};

/**
 * What went out and how it is doing, kept current: the server reads the touches each send records, and the
 * page asks for fresh numbers every minute and whenever the tab comes back into view.
 */
export function SentView({ owner, stats, listHref, updatedAt }: { owner: string; stats: SentStats; listHref: string; updatedAt: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<{ kind: Kind; label: string } | null>(null);
  const [show, setShow] = useState<Show>("all");

  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") router.refresh(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);

  const top = Math.max(1, ...stats.daily.map((day) => day.sent));
  const shows: Array<[Show, string, number]> = [
    ["all", "All", stats.recent.length],
    ["replied", "Replied", stats.recent.filter((row) => row.outcome === "replied" || row.outcome === "interested").length],
    ["interested", "Interested", stats.recent.filter((row) => row.outcome === "interested").length],
    ["bounced", "Bounced", stats.recent.filter((row) => row.outcome === "bounced").length],
    ["followups", "Follow-ups", stats.recent.filter((row) => row.followup).length],
  ];
  const rows = stats.recent.filter((row) =>
    (show === "all" || (show === "replied" ? row.outcome === "replied" || row.outcome === "interested" : show === "followups" ? row.followup : row.outcome === show)) &&
    (!filter || (!row.followup && row[filter.kind] === filter.label)));

  const mix = (kind: Kind, title: string) => {
    const items = stats.mix[kind];
    const most = Math.max(1, ...items.map((item) => item.count));
    return (
      <div className="as-mix-card">
        <h3>{title}</h3>
        {items.map((item) => {
          const active = filter?.kind === kind && filter.label === item.label;
          return (
            <button key={item.label} type="button" className={`as-bar ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setFilter(active ? null : { kind, label: item.label })}>
              <span className="as-bar-label">{item.label}</span>
              <span className="as-bar-track"><span style={{ width: `${Math.round((item.count / most) * 100)}%` }} /></span>
              <b>{item.count}</b>
            </button>
          );
        })}
      </div>
    );
  };

  const period = PERIODS.find(([days]) => days === stats.days)?.[1] ?? `Last ${stats.days} days`;
  return (
    <div className="sent-page">
      <div className="sent-toolbar">
        <nav className="sent-periods" aria-label="Period">
          {PERIODS.map(([days, label]) => <Link key={days} href={`/drafts/sent?owner=${owner}&days=${days}`} className={stats.days === days ? "is-active" : ""}>{label}</Link>)}
        </nav>
        <span className="sent-live"><span className="sent-dot" aria-hidden="true" />Live · updated {new Date(updatedAt).toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit" })}</span>
      </div>

      <section className="sent-tiles" aria-label={`${period} at a glance`}>
        <div className="sent-tile"><span>Sent</span><b>{stats.sent}</b><small>{stats.firsts} first {stats.firsts === 1 ? "email" : "emails"} · {stats.followups} follow-up{stats.followups === 1 ? "" : "s"}</small></div>
        <div className="sent-tile"><span>Replies</span><b>{stats.replies}</b><small>{stats.replyRate}% of emails sent</small></div>
        <div className="sent-tile is-good"><span>Interested</span><b>{stats.interested}</b><small>positive replies and referrals</small></div>
        <div className={`sent-tile ${stats.bounceRate >= 5 ? "is-bad" : ""}`}><span>Bounced</span><b>{stats.bounced}</b><small>{stats.bounceRate}% of emails sent</small></div>
      </section>

      {stats.days > 1 && (
        <section className="sent-chart-card" aria-label="By day">
          <div className="as-queue-head"><h2>By day</h2><p><span className="sent-key is-sent" /> sent <span className="sent-key is-reply" /> got a reply</p></div>
          <div className="sent-chart">
            {stats.daily.map((day) => (
              <div key={day.date} className="sent-col" title={`${day.label}: ${day.sent} sent, ${day.replies} replied`}>
                <b>{day.sent || ""}</b>
                <div className="sent-col-bar" style={{ height: `${Math.round((day.sent / top) * 100)}%` }}>
                  {day.replies > 0 && <span style={{ height: `${Math.round((day.replies / Math.max(1, day.sent)) * 100)}%` }} />}
                </div>
                <small>{day.label.replace(/, .*$/, "")}</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {stats.firsts > 0 && (
        <section className="as-mix" aria-label="Who they went to">
          <div className="as-queue-head"><h2>Who they went to</h2><p>First emails only. Click a bar to see just those below.</p></div>
          <div className="as-mix-grid">
            {mix("industry", "Industry")}
            {mix("role", "Who it went to")}
            {mix("size", "Company size")}
          </div>
        </section>
      )}

      {stats.versions.length > 0 && (
        <section className="sent-versions" aria-label="Which version gets replies">
          <div className="as-queue-head"><h2>Which version gets replies</h2><p>First emails only. New list emails rotate between versions, so this fills in as you send.</p></div>
          <table className="sent-version-table">
            <thead><tr><th>Version</th><th>Sent</th><th>Replies</th><th>Reply rate</th><th>Interested</th><th>Bounced</th></tr></thead>
            <tbody>{stats.versions.map((version) => (
              <tr key={version.label}><td>{version.label}</td><td>{version.sent}</td><td>{version.replies}</td><td>{version.replyRate}%</td><td>{version.interested}</td><td>{version.bounced}</td></tr>
            ))}</tbody>
          </table>
          {Math.min(...stats.versions.filter((version) => version.label !== "Not recorded").map((version) => version.sent), Infinity) < 50 && <p className="sent-version-note">Too early to call: each version needs about 50 first emails before the difference means much. Try Last 30 days for more.</p>}
        </section>
      )}

      <section className="as-queue" aria-label="Sent emails">
        <div className="as-queue-head"><h2>Sent emails <span>{rows.length}</span></h2><p>Newest first. Click a company to open it on the Reach-out list.</p></div>
        <div className="sent-shows" role="tablist" aria-label="Show">
          {shows.map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={show === key} className={show === key ? "is-active" : ""} onClick={() => setShow(key)}>{label} ({count})</button>)}
          {filter && <button type="button" className="btn ghost" onClick={() => setFilter(null)}>Clear {filter.label}</button>}
        </div>
        {rows.length === 0
          ? <p className="as-empty">{stats.sent === 0 ? `Nothing was sent ${stats.days === 1 ? "today" : `in the ${period.toLowerCase()}`} yet.` : "Nothing matches that."}</p>
          : <ol className="as-list">
              {rows.map((row) => (
                <li key={row.id} className="sent-row">
                  <span className="sent-when">{when(row.sentAt)}</span>
                  <span className="as-who"><b>{row.name}</b><small>{row.title || row.role}</small></span>
                  <span className="as-company"><Link href={`${listHref}&card=${row.cardId}`}>{row.company}</Link><small>{row.followup ? "Follow-up" : row.subject || `${row.industry} · ${row.size}`}</small></span>
                  <span className={`sent-outcome is-${row.outcome.replace(/ /g, "-")}`}>{OUTCOME_LABEL[row.outcome]}</span>
                </li>
              ))}
            </ol>}
      </section>
    </div>
  );
}
