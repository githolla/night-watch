"use client";

import Link from "next/link";
import { ArrowRight, Bell, Building2, Check, ChevronRight, Linkedin, MailCheck, MessagesSquare, PenLine, Search, Send } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { ListSummary } from "@/lib/company-lists";
import type { HomeData } from "@/lib/home-view";
import type { SeriesDay } from "@/lib/home-stats";
import type { Owner } from "@/lib/types";

type Range = 7 | 14 | 30 | 90;
const RANGES: Range[] = [7, 14, 30, 90];
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sum = (days: SeriesDay[], key: "sent" | "interested" | "bounced") => days.reduce((total, day) => total + day[key], 0);
const listName = (date: string) => `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} list`;
const minutes = (n: number) => n < 60 ? `${n} min` : `${Math.floor(n / 60)} h ${n % 60 ? `${n % 60} min` : ""}`.trim();

/** The one link style on Overview: words in the accent colour with an arrow that moves on hover. */
const Go = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="ov-go" href={href}>{children}<ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></Link>
);

/** One list's progress as a single bar: sent, ready, in review and missing an email. */
function Progress({ list }: { list: ListSummary }) {
  const total = Math.max(1, list.companies);
  const parts: Array<[keyof ListSummary["progress"], string]> = [["sent", "sent"], ["ready", "ready"], ["review", "review"], ["missing", "missing email"]];
  return (
    <div className="ov-progress">
      <span className="ov-bar" aria-hidden="true">{parts.map(([key]) => list.progress[key] > 0 && <span key={key} className={`is-${key}`} style={{ width: `${(list.progress[key] / total) * 100}%` }} />)}</span>
      <small>{parts.filter(([key]) => list.progress[key] > 0).map(([key, label]) => `${list.progress[key]} ${label}`).join(" · ") || "No companies yet"}</small>
    </div>
  );
}

type Lane = { key: string; icon: ReactNode; who: "Night Watch" | "You"; title: string; value: number; unit: string; sub: string; href: string; needs: boolean };
/** A step is one card, or two lanes side by side when email and LinkedIn go different ways. */
type Step = Lane & { lanes?: Lane[] };
type Todo = { key: string; title: string; why: string; mins: number; href?: string; action?: ReactNode; optional?: boolean };

/**
 * Overview, read in the morning and shown to anyone new: what happened overnight, how Night Watch works with
 * live numbers at each step, and the short list of what she needs to do, in order, with how long it takes.
 */
export function HomeView({ data, owner, hello, today, aside }: { data: HomeData; owner: Owner; hello: string; today: string; aside?: ReactNode }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const d = data.drafts;
  const [range, setRange] = useState<Range>(30);
  const [shelf, setShelf] = useState<"current" | "archived">("current");

  const days = useMemo(() => data.series.slice(-range), [data.series, range]);
  const on = Boolean(auto && !auto.plan.blocker);
  const paused = Boolean(auto?.control.paused);
  const day = auto ? auto.plan.dayLabel.charAt(0).toUpperCase() + auto.plan.dayLabel.slice(1) : "";
  const sendWindow = auto ? `${day}, ${auto.plan.windowLabel} ET` : null;
  const interested = data.replies.filter((item) => ["positive", "referral"].includes(item.classification));
  const other = data.replies.length - interested.length;
  const current = data.lists.filter((list) => list.status !== "Done");
  const archived = data.lists.filter((list) => list.status === "Done");
  const companies = current.reduce((total, list) => total + list.companies, 0);
  const latest = data.lists.find((list) => !list.building);
  const yesterday = data.series.at(-2)?.sent ?? 0;

  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    paused && { text: `Auto-send is paused${auto?.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  // Overnight, in plain sentences: the list, what went out, who wrote back, what goes next.
  const briefing = [
    data.building ? "Night Watch is building tonight's list right now." : latest ? `Your ${listName(latest.date)} has ${count(latest.companies, "company", "companies")}: ${latest.progress.ready + latest.progress.review ? `${count(latest.progress.ready + latest.progress.review, "email is", "emails are")} ready for you` : "no emails are ready yet"}${latest.progress.missing ? `, and Night Watch is still finding addresses for ${latest.progress.missing}` : ""}.` : "No new list in the last few days.",
    yesterday ? `${count(yesterday, "email", "emails")} went out yesterday.` : "",
    data.linkedin ? `${count(data.linkedin, "LinkedIn message is", "LinkedIn messages are")} ready for you to send by hand.` : "",
    data.newReplies ? `${count(data.newReplies, "new reply", "new replies")} came in${interested.length ? `, ${interested.length} interested` : ""}.` : "No new replies since yesterday.",
    on && auto ? `Auto-send sends ${count(auto.plan.going, "email", "emails")} ${day === "Today" ? "today" : `on ${day}`}, ${auto.plan.windowLabel} ET.` : "Auto-send is off, so nothing goes out until you turn it on.",
  ].filter(Boolean);

  const steps: Step[] = [
    { key: "find", icon: <Search size={18} strokeWidth={2} />, who: "Night Watch", title: "Finds companies", value: companies, unit: companies === 1 ? "company on the list" : "companies on the list", sub: latest ? `Newest: ${listName(latest.date)}` : "A new list each weeknight", href: `/outreach?list=${owner}`, needs: false },
    { key: "write", icon: <PenLine size={18} strokeWidth={2} />, who: "Night Watch", title: "Researches and writes", value: d.total, unit: d.total === 1 ? "email written" : "emails written", sub: `${count(d.linkedinWritten, "LinkedIn message", "LinkedIn messages")} too${d.missing ? ` · ${d.missing} finding an address` : ""}`, href: `/drafts?${q}`, needs: false },
    { key: "review", icon: <MailCheck size={18} strokeWidth={2} />, who: "You", title: "Review and approve", value: d.review, unit: "to review", sub: `${d.ready} approved so far`, href: `/drafts?${q}&tab=review`, needs: d.nextUnapproved > 0 },
    { key: "send", icon: <Send size={18} strokeWidth={2} />, who: on ? "Night Watch" : "You", title: "Sends and follows up", value: 0, unit: "", sub: "", href: `/auto-send?${q}`, needs: false, lanes: [
      { key: "email", icon: <Send size={16} strokeWidth={2} />, who: on ? "Night Watch" : "You", title: on ? "Email: sent for you" : "Email: auto-send off", value: auto?.plan.going ?? 0, unit: day ? `sending ${day === "Today" ? "today" : day}` : "sending next", sub: on ? `${auto?.plan.sentToday ?? 0} of ${auto?.plan.dailyCap ?? 0} sent today, follow-ups automatic` : "Turn it on to send approved emails", href: `/auto-send?${q}`, needs: !on && d.ready > 0 },
      { key: "linkedin", icon: <Linkedin size={16} strokeWidth={2} />, who: "You", title: "LinkedIn: you send by hand", value: data.linkedin, unit: "ready to send", sub: `Copy, open profile, mark sent · ${data.linkedinSent} sent this week`, href: `/linkedin?${q}`, needs: data.linkedin > 0 },
    ] },
    { key: "reply", icon: <MessagesSquare size={18} strokeWidth={2} />, who: "You", title: "Replies and meetings", value: data.replies.length, unit: data.replies.length === 1 ? "reply waiting" : "replies waiting", sub: count(data.meetings, "meeting booked", "meetings booked"), href: `/replies?${q}`, needs: data.replies.length > 0 },
  ];

  const todos: Todo[] = [
    ...(interested.length ? [{ key: "interested", title: interested.length === 1 ? `Reply to ${interested[0].name}${interested[0].company ? ` at ${interested[0].company}` : ""}` : `Reply to ${interested.length} interested people`, why: "They said yes. Answer while it's fresh; the call brief has what you need.", mins: interested.length * 5, href: `/replies?${q}` }] : []),
    ...(other ? [{ key: "other", title: `Read ${count(other, "other reply", "other replies")}`, why: "A question or an objection. Decide the next step.", mins: other * 2, href: `/replies?${q}` }] : []),
    ...data.bounces.slice(0, 3).map((bounce) => ({ key: `b-${bounce.personId}`, title: `${bounce.name} bounced`, why: `${bounce.company}${bounce.email ? `: ${bounce.email} didn't arrive` : ""}. A corrected address reopens it.`, mins: 1, action: <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /> })),
    ...(data.followupsDue ? [{ key: "followups", title: `Send ${count(data.followupsDue, "follow-up", "follow-ups")}`, why: "They came due and couldn't go out by themselves.", mins: data.followupsDue * 2, href: `/followups?view=needs&${q}` }] : []),
    ...(d.nextUnapproved ? [{ key: "review", title: `Review the ${count(d.nextUnapproved, "email", "emails")} sending ${day === "Today" ? "today" : day}`, why: "Read each one; approve it, fix it or hold it back.", mins: Math.max(2, Math.round(d.nextUnapproved * 0.75)), href: `/drafts?${q}&tab=review` }] : []),
    ...(data.linkedin ? [{ key: "linkedin", title: `Send ${count(data.linkedin, "LinkedIn message", "LinkedIn messages")}`, why: "Copy each one, open the profile, send it there, mark it sent.", mins: data.linkedin * 2, href: `/linkedin?${q}` }] : []),
    ...(!on && !paused && d.ready ? [{ key: "auto", title: "Turn on auto-send", why: `${count(d.ready, "approved email is", "approved emails are")} waiting and nothing goes out while it's off.`, mins: 1, href: `/auto-send?${q}` }] : []),
    ...(!d.nextUnapproved && d.review ? [{ key: "ahead", title: `Get ahead: review ${count(d.review, "draft", "drafts")}`, why: "Nothing is due today. Reading ahead keeps the next windows full.", mins: Math.round(d.review * 0.75), href: `/drafts?${q}&tab=review`, optional: true }] : []),
  ];
  const needed = todos.filter((todo) => !todo.optional);
  const total = needed.reduce((sum, todo) => sum + todo.mins, 0);

  const results = [
    { label: "Positive replies", value: sum(days, "interested"), href: `/replies?${q}` },
    { label: "Meetings booked", value: data.meetings, href: "/pipeline" },
    { label: "Emails sent", value: sum(days, "sent"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
    { label: "Bounces", value: sum(days, "bounced"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
  ];
  const shownLists = shelf === "current" ? current : archived;
  const nextHref = (list: ListSummary) => list.next === "wait" ? null : list.next === "review" ? { href: `/drafts?${q}&tab=review`, label: "Review drafts" } : list.next === "contacts" ? { href: `/outreach?list=${owner}`, label: "Find contacts" } : { href: "/stats", label: "See results" };

  return (
    <div className="home ov">
      <header className="ov-top page-top">
        <nav className="ov-crumbs" aria-label="Where you are"><span>Workspace</span><span aria-hidden="true">/</span><b>Overview</b></nav>
        <div className="ov-top-side">
          {aside}
          <Link className={`ov-bell ${data.replies.length ? "has-dot" : ""}`} href={`/replies?${q}`} aria-label={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "Replies"} title={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"}><Bell size={19} strokeWidth={1.8} /></Link>
        </div>
      </header>

      <section className="ov-brief" aria-label="This morning">
        <p className="ov-hi">{hello}, {data.first}.</p>
        <h1>Here&rsquo;s your {today}.</h1>
        <p className="ov-story">{briefing.join(" ")}</p>
      </section>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <section className="home-auto ov-flow" aria-label="How Night Watch works">
        <div className="ov-flow-head">
          <h2>How Night Watch works</h2>
          <p>Overnight it finds companies, researches them and writes an email and a LinkedIn message for each. You review. Emails send and follow up by themselves; LinkedIn messages you send by hand in a minute each. Replies come back to you.</p>
        </div>
        <ol className="ov-steps">
          {steps.map((step, index) => step.lanes ? (
            <li key={step.key} className="is-split">
              <span className="ov-split-head"><b className="ov-step-title">{index + 1} · {step.title}</b></span>
              {step.lanes.map((lane) => (
                <Link key={lane.key} href={lane.href} className={`ov-lane ${lane.who === "You" ? "is-you" : ""} ${lane.needs ? "is-needs" : ""}`}>
                  <span className="ov-lane-top"><span className="ov-step-icon is-sm" aria-hidden="true">{lane.icon}</span><b>{lane.title}</b></span>
                  <span className="ov-step-value"><b>{lane.value.toLocaleString()}</b> {lane.unit}</span>
                  <small>{lane.needs ? "Needs you" : lane.sub}</small>
                </Link>
              ))}
            </li>
          ) : (
            <li key={step.key} className={`${step.who === "You" ? "is-you" : ""} ${step.needs ? "is-needs" : ""}`}>
              <Link href={step.href}>
                <span className="ov-step-top">
                  <span className="ov-step-icon" aria-hidden="true">{step.icon}</span>
                  <span className="ov-step-who">{index + 1} · {step.who}</span>
                </span>
                <b className="ov-step-title">{step.title}</b>
                <span className="ov-step-value"><b>{step.value.toLocaleString()}</b> {step.unit}</span>
                <small>{step.needs ? "Needs you" : step.sub}</small>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <div className="ov-pair">
        <section className="home-card ov-panel home-needs ov-todo" aria-label="This morning">
          <div className="ov-panel-head">
            <div><h2>What you need to do</h2><p>{needed.length ? `${count(needed.length, "thing", "things")}, about ${minutes(Math.max(total, 1))}, in this order.` : "Nothing is due this morning."}</p></div>
          </div>
          {needed.length === 0 && <div className="ov-done"><span aria-hidden="true"><Check size={26} strokeWidth={2.4} /></span><b>You&rsquo;re all caught up</b><small>Night Watch keeps finding companies and writing emails and LinkedIn messages. New work shows up here.</small></div>}
          {todos.length > 0 && (
            <ol className="ov-todos">
              {todos.map((todo, index) => {
                const body = <>
                  <span className={`ov-num ${todo.optional ? "is-optional" : ""}`} aria-hidden="true">{todo.optional ? <Check size={14} strokeWidth={2.4} /> : index + 1}</span>
                  <span className="ov-todo-text"><b>{todo.title}</b><small>{todo.why}</small></span>
                  <span className="ov-mins">{todo.optional ? "optional" : `~${minutes(todo.mins)}`}</span>
                </>;
                return (
                  <li key={todo.key}>
                    {todo.href && !todo.action
                      ? <Link className="ov-todo-row is-link" href={todo.href}>{body}<ChevronRight className="ov-chev" size={18} strokeWidth={2} aria-hidden="true" /></Link>
                      : <div className="ov-todo-row">{body}{todo.action && <span className="ov-act">{todo.action}</span>}</div>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="home-card ov-panel ov-next" aria-label="Sending next">
          <div className="ov-panel-head"><h2>Sending next</h2><span className={`ov-dot is-${paused ? "bad" : on ? "ok" : "warn"}`}>{paused ? "Paused" : on ? "Auto-send on" : "Auto-send off"}</span></div>
          <p className="ov-next-big">{on && auto ? <><b>{auto.plan.going}</b> {auto.plan.going === 1 ? "email" : "emails"}</> : <b>Nothing</b>}</p>
          <p className="ov-next-when">{on && sendWindow ? sendWindow : "Turn on auto-send to send approved emails each weekday morning."}</p>
          <dl className="ov-next-facts">
            <div><dt>Sent today</dt><dd>{auto ? `${auto.plan.sentToday} of ${auto.plan.dailyCap}` : "Not known"}</dd></div>
            <div><dt>Approved and waiting</dt><dd>{d.ready}</dd></div>
            <div><dt>Follow-ups</dt><dd>{data.followupsDue ? `${data.followupsDue} need you` : "On schedule"}</dd></div>
          </dl>
          <div className="ov-panel-foot"><span>{on ? "Approval doesn't hold an email back; use Hold." : "Nothing sends while it's off."}</span><Go href={`/auto-send?${q}`}>Manage sending</Go></div>
        </section>
      </div>

      <section id="lists" className="home-card ov-panel ov-lists" aria-label="Companies to email">
        <div className="ov-panel-head">
          <div><h2>Companies to email</h2><p>The companies Night Watch picks each night, how far outreach got and the next useful step.</p></div>
          <div className="ov-tabs" role="tablist" aria-label="Lists">
            <button type="button" role="tab" aria-selected={shelf === "current"} className={shelf === "current" ? "is-on" : ""} onClick={() => setShelf("current")}>Current <span>{current.length}</span></button>
            <button type="button" role="tab" aria-selected={shelf === "archived"} className={shelf === "archived" ? "is-on" : ""} onClick={() => setShelf("archived")}>Done <span>{archived.length}</span></button>
          </div>
        </div>
        {shownLists.length
          ? <div className="ov-table" role="table" aria-label="Companies to email">
              <div className="ov-tr is-head" role="row"><span role="columnheader">List / audience</span><span role="columnheader">Companies</span><span role="columnheader">Outreach progress</span><span role="columnheader">Results</span><span role="columnheader">Status</span><span role="columnheader">Next step</span></div>
              {shownLists.map((list) => {
                const action = nextHref(list);
                const cells = <>
                  <span role="cell" className="ov-td-name"><span className="ov-logos">{list.logos.map((domain) => <CompanyLogo key={domain} domain={domain} name={domain} size={26} nested />)}</span><span><b>{listName(list.date)}</b><small>{list.sectors.join(" · ") || "Mixed sectors"}</small></span></span>
                  <span role="cell" className="ov-td-num">{list.companies}</span>
                  <span role="cell"><Progress list={list} /></span>
                  <span role="cell" className="ov-td-results">{count(list.positive, "positive reply", "positive replies")} · {count(list.meetings, "meeting", "meetings")}</span>
                  <span role="cell"><span className={`ov-dot is-${list.status === "Active" ? "ok" : list.status === "Preparing" ? "warn" : "muted"}`}>{list.status}</span></span>
                  <span role="cell" className="ov-td-next">{action ? <>{action.label}<ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></> : <span className="ov-muted">Being prepared</span>}</span>
                </>;
                return action
                  ? <Link key={list.date} className="ov-tr is-link" role="row" href={action.href}>{cells}</Link>
                  : <div key={list.date} className="ov-tr" role="row">{cells}</div>;
              })}
            </div>
          : <p className="ov-empty"><Building2 size={18} strokeWidth={1.9} aria-hidden="true" />{shelf === "current" ? "No current lists. A new one arrives each weeknight." : "No finished lists in the last 30 days."}</p>}
        <div className="ov-panel-foot"><span>Each company counts once, at its furthest step.</span><Go href={`/outreach?list=${owner}`}>Open all companies</Go></div>
      </section>

      <section className="home-card ov-panel home-week ov-results" aria-label="Results">
        <div className="ov-panel-head">
          <h2>Is it working?</h2>
          <div className="ov-results-tools">
            <label className="ov-period"><span className="sr-only">Period</span>
              <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>{RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}</select>
            </label>
            <Go href="/stats">Explore results</Go>
          </div>
        </div>
        <div className="ov-results-row">
          {results.map((item) => <Link key={item.label} className="ov-result" href={item.href}><b>{item.value}</b><span>{item.label}</span></Link>)}
        </div>
        <p className="ov-footnote">Email outcomes. Meetings are what&rsquo;s on the calendar now. LinkedIn sends count once you mark them sent.</p>
      </section>
    </div>
  );
}
