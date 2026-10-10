import Link from "next/link";
import { AddressFix } from "@/components/AddressFix";
import type { HomeData } from "@/lib/home-view";
import type { Owner } from "@/lib/types";

const READS: Record<string, string> = { positive: "Interested", referral: "Referral", neutral: "Replied", objection: "Pushback", negative: "Not interested" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Home: what needs her today, in the order it matters, each item one click from where it is handled. */
export function HomeView({ data, owner, hello }: { data: HomeData; owner: Owner; hello: string }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const on = Boolean(auto && !auto.plan.blocker);
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    data.week && data.week.sent >= 5 && data.week.bounceRate >= 5 && { text: `${data.week.bounceRate}% of this week's emails bounced. Fix the addresses below before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  return (
    <div className="home">
      <header className="home-head">
        <h1>{hello}, {data.first}.</h1>
        <p>Here is your day in Night Watch.</p>
      </header>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <div className="home-grid">
        <section className="home-card home-replies" aria-label="Replies waiting">
          <div className="home-card-head"><h2>Replies waiting <span>{data.replies.length}</span></h2><Link href={`/activity`}>History &rarr;</Link></div>
          {data.replies.length === 0
            ? <p className="home-empty">No replies waiting. When someone writes back, they show up here and in your inbox.</p>
            : <ul className="home-list">{data.replies.slice(0, 6).map((reply) => (
                <li key={reply.cardId}>
                  <span className={`home-read is-${reply.classification}`}>{READS[reply.classification] ?? "Replied"}</span>
                  <span className="home-who"><b>{reply.name}</b><small>{reply.title ? `${reply.title} · ` : ""}{reply.company} · {day(reply.repliedAt)}</small></span>
                  <Link className="btn" href={`/brief/${reply.cardId}`}>Call brief</Link>
                </li>
              ))}</ul>}
        </section>

        <section className={`home-card home-auto ${on ? "is-on" : ""}`} aria-label="Going out today">
          <div className="home-card-head"><h2>Auto-send</h2><Link href={`/auto-send?${q}`}>Open &rarr;</Link></div>
          {!auto
            ? <p className="home-empty">Auto-send could not be read just now.</p>
            : <>
                <p className="home-big"><b>{auto.plan.going}</b> {auto.plan.going === 1 ? "email" : "emails"} {on ? "go out" : "would go out"} {auto.plan.dayLabel}</p>
                <p className="home-sub">{on ? (auto.control.skippedToday ? "On, but skipped today." : `On · ${auto.plan.windowLabel} Eastern`) : auto.plan.blocker}{auto.plan.later ? ` · ${auto.plan.later} more after that` : ""}</p>
                <p className="home-sub">Sent today: {auto.plan.sentToday} of {auto.plan.dailyCap}</p>
              </>}
        </section>

        <section className="home-card home-needs" aria-label="Needs you">
          <div className="home-card-head"><h2>Needs you <span>{data.bounces.length + (auto?.unconfirmedQueued ? 1 : 0)}</span></h2></div>
          {data.bounces.length === 0 && !auto?.unconfirmedQueued
            ? <p className="home-empty">Nothing needs you right now.</p>
            : <ul className="home-list">
                {data.bounces.slice(0, 5).map((bounce) => (
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
        </section>

        <section className="home-card home-newlist" aria-label="Newest list">
          <div className="home-card-head"><h2>Newest list</h2><Link href={`/outreach?list=${owner}`}>Reach-out list &rarr;</Link></div>
          {!data.list
            ? <p className="home-empty">No new list in the last few days. A fresh one is built each weeknight.</p>
            : <>
                <p className="home-big"><b>{data.list.companies}</b> companies · {day(`${data.list.date}T12:00:00Z`)}</p>
                <p className="home-sub">{data.list.confirmed} of {data.list.companies} addresses confirmed</p>
                <p className="home-tags">{data.list.sectors.slice(0, 5).map((sector) => <span key={sector.label}>{sector.label} {sector.count}</span>)}</p>
              </>}
        </section>
      </div>

      {data.week && (
        <section className="home-week" aria-label="Your week">
          <div className="home-card-head"><h2>Your week</h2><Link href={`/drafts/sent?${q}&days=7`}>What was sent &rarr;</Link></div>
          <div className="home-tiles">
            <div><span>Sent</span><b>{data.week.sent}</b><small>{data.week.firsts} first · {data.week.followups} follow-ups</small></div>
            <div><span>Replies</span><b>{data.week.replies}</b><small>{data.week.replyRate}% of emails</small></div>
            <div className="is-good"><span>Interested</span><b>{data.week.interested}</b><small>positive or referral</small></div>
            <div className={data.week.bounceRate >= 5 ? "is-bad" : ""}><span>Bounced</span><b>{data.week.bounced}</b><small>{data.week.bounceRate}% of emails</small></div>
          </div>
        </section>
      )}
    </div>
  );
}
