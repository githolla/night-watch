"use client";

import Link from "next/link";
import { ArrowRight, Bell, ChevronRight, CircleAlert, FileText, Inbox, Linkedin, Mail, MessageSquare, Reply, Search, SearchCheck, Send, ShieldCheck } from "lucide-react";
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
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** The one link style on Overview: words in the accent colour with an arrow that moves on hover. */
const Go = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="ov-go" href={href}>{children}<ArrowRight size={15} strokeWidth={2} aria-hidden="true" /></Link>
);

type Row = { key: string; icon: ReactNode; tone: "ok" | "warn" | "bad" | "muted" | "brand"; title: ReactNode; sub: ReactNode; href?: string; action?: ReactNode };

/** Rows that go somewhere are links end to end; a row with its own control (Fix address) keeps it. */
function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="ov-rows">
      {rows.map((row) => {
        const body = <>
          <span className={`ov-glyph is-${row.tone}`} aria-hidden="true">{row.icon}</span>
          <span className="ov-row-text"><b>{row.title}</b><small>{row.sub}</small></span>
        </>;
        return (
          <li key={row.key}>
            {row.href && !row.action
              ? <Link className="ov-row is-link" href={row.href}>{body}<ChevronRight className="ov-chev" size={18} strokeWidth={2} aria-hidden="true" /></Link>
              : <div className="ov-row">{body}{row.action && <span className="ov-act">{row.action}</span>}</div>}
          </li>
        );
      })}
    </ul>
  );
}

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

/** Overview: the one next action, what needs you, what Nightwatch is doing, how each list is going and what it produced. */
export function HomeView({ data, owner, hello, aside }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const d = data.drafts;
  const [range, setRange] = useState<Range>(30);
  const [shelf, setShelf] = useState<"current" | "archived">("current");
  const [find, setFind] = useState("");

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
  const needle = find.trim().toLowerCase();
  const shownLists = (shelf === "current" ? current : archived).filter((list) => !needle || `${listName(list.date)} ${list.sectors.join(" ")}`.toLowerCase().includes(needle));

  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    paused && { text: `Auto-send is paused${auto?.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const next = interested.length
    ? { title: `Reply to ${interested[0].name}${interested[0].company ? ` at ${interested[0].company}` : ""}`, text: `${count(interested.length, "interested reply is", "interested replies are")} waiting. Answer while the conversation is fresh.`, meta: "Their words and the next step are on Replies, with the call brief one click away.", href: `/replies?${q}`, action: "Open replies" }
    : d.nextUnapproved
    ? { title: `Review ${count(d.nextUnapproved, "email", "emails")} for ${day}`, text: `${d.next - d.nextUnapproved} of the ${d.next} emails in ${day}'s window are approved. Read the rest before they go.`, meta: "Progress saves as you go. Company research sits beside each draft.", href: `/drafts?${q}`, action: "Start review" }
    : data.bounces.length
    ? { title: `Fix ${count(data.bounces.length, "bounced address", "bounced addresses")}`, text: "Those emails never arrived. A corrected address reopens the company for sending.", meta: "Fix address is right below, under Needs your attention.", href: "#attention", action: "Fix them" }
    : data.followupsDue
    ? { title: `Send ${count(data.followupsDue, "follow-up", "follow-ups")}`, text: "They came due but couldn't go out by themselves, usually because the address isn't confirmed.", meta: "Open one to send, change or skip it.", href: `/followups?view=needs&${q}`, action: "Open follow-ups" }
    : data.linkedin
    ? { title: `Send ${count(data.linkedin, "LinkedIn message", "LinkedIn messages")}`, text: "Copy each message, open the profile, send it there, then mark it sent.", meta: "LinkedIn goes out by hand.", href: `/linkedin?${q}`, action: "Open LinkedIn tasks" }
    : d.review
    ? { title: `Review ${count(d.review, "draft", "drafts")}`, text: "Nothing is due today. Getting ahead keeps the next windows full of emails you've read.", meta: "Progress saves as you go.", href: `/drafts?${q}`, action: "Start review" }
    : { title: "You're all caught up", text: "New companies and drafts arrive with each weeknight's list.", meta: "Add companies any time from Discover companies.", href: "/targets", action: "Find companies" };

  const attention: Row[] = [
    ...(interested.length ? [{ key: "interested", icon: <Reply size={18} strokeWidth={2} />, tone: "ok" as const, title: count(interested.length, "interested reply", "interested replies"), sub: "Respond while the conversation is fresh", href: `/replies?${q}` }] : []),
    ...(other ? [{ key: "other", icon: <MessageSquare size={18} strokeWidth={2} />, tone: "muted" as const, title: `${count(other, "other reply", "other replies")} to review`, sub: "Read it and decide the next step", href: `/replies?${q}` }] : []),
    ...data.bounces.slice(0, 3).map((bounce) => ({ key: `b-${bounce.personId}`, icon: <CircleAlert size={18} strokeWidth={2} />, tone: "bad" as const, title: `${bounce.name} bounced`, sub: `${bounce.company}${bounce.email ? ` · ${bounce.email}` : ""}`, action: <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /> })),
    ...(data.followupsDue ? [{ key: "followups", icon: <Send size={18} strokeWidth={2} />, tone: "warn" as const, title: `${count(data.followupsDue, "follow-up", "follow-ups")} to send`, sub: "Came due and couldn't go out by themselves", href: `/followups?view=needs&${q}` }] : []),
    ...(data.linkedin ? [{ key: "linkedin", icon: <Linkedin size={18} strokeWidth={2} />, tone: "brand" as const, title: `${count(data.linkedin, "LinkedIn message", "LinkedIn messages")} ready`, sub: "Copy, open profile, then mark sent", href: `/linkedin?${q}` }] : []),
    ...(d.review ? [{ key: "review", icon: <FileText size={18} strokeWidth={2} />, tone: "muted" as const, title: `${count(d.review, "draft", "drafts")} awaiting review`, sub: `${d.ready} approved so far`, href: `/drafts?${q}&tab=review` }] : []),
  ];

  const working: Row[] = [
    ...(data.building ? [{ key: "building", icon: <FileText size={18} strokeWidth={2} />, tone: "muted" as const, title: "Preparing tonight's list", sub: "Researching companies and writing drafts", href: `/outreach?list=${owner}` }] : []),
    ...(d.missing ? [{ key: "missing", icon: <Search size={18} strokeWidth={2} />, tone: "muted" as const, title: "Finding contacts", sub: `${count(d.missing, "company", "companies")} without an email address yet`, href: `/drafts?${q}` }] : []),
    ...(d.checking ? [{ key: "checking", icon: <SearchCheck size={18} strokeWidth={2} />, tone: "muted" as const, title: "Confirming addresses", sub: `${count(d.checking, "address", "addresses")} being checked, every 20 minutes`, href: `/auto-send?${q}` }] : []),
    ...(on && auto ? [{ key: "sending", icon: <Mail size={18} strokeWidth={2} />, tone: "muted" as const, title: `Sending ${day}`, sub: `${count(auto.plan.going, "email", "emails")} in the ${auto.plan.windowLabel} ET window`, href: `/auto-send?${q}` }] : []),
    ...(data.followupsDue === 0 ? [{ key: "followups", icon: <ShieldCheck size={18} strokeWidth={2} />, tone: "muted" as const, title: "Follow-ups on schedule", sub: "They go out by themselves 3 and 10 business days after each first email", href: `/followups?view=upcoming&${q}` }] : []),
  ];

  const results = [
    { label: "Positive replies", value: sum(days, "interested"), href: `/replies?${q}` },
    { label: "Meetings booked", value: data.meetings, href: "/pipeline" },
    { label: "Emails sent", value: sum(days, "sent"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
    { label: "Bounces", value: sum(days, "bounced"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
  ];
  const figures = [
    { value: companies, label: companies === 1 ? "company" : "companies", href: `/outreach?list=${owner}` },
    { value: current.length, label: `current ${current.length === 1 ? "list" : "lists"}`, href: "#lists" },
    { value: d.ready, label: "ready to send", href: `/drafts?${q}&tab=approved` },
    { value: d.review, label: "awaiting review", href: `/drafts?${q}&tab=review` },
  ];
  const nextHref = (list: ListSummary) => list.next === "wait" ? null : list.next === "review" ? { href: `/drafts?${q}`, label: "Review drafts" } : list.next === "contacts" ? { href: `/outreach?list=${owner}`, label: "Find contacts" } : { href: "/stats", label: "See results" };

  return (
    <div className="home ov">
      <header className="ov-top page-top">
        <nav className="ov-crumbs" aria-label="Where you are"><span>Workspace</span><span aria-hidden="true">/</span><b>Overview</b></nav>
        <div className="ov-top-side">
          {aside}
          <Link className={`ov-bell ${data.replies.length ? "has-dot" : ""}`} href={`/replies?${q}`} aria-label={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "Replies"} title={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"}><Bell size={19} strokeWidth={1.8} /></Link>
        </div>
      </header>

      <div className="ov-head">
        <p className="ov-hi">{hello}, {data.first}.</p>
        <h1>Your outreach, at a glance</h1>
        <p className="ov-sub">Review what needs you. See what Nightwatch is handling.</p>
        <nav className="ov-figures" aria-label="Where things stand">
          {figures.map((figure) => <Link key={figure.label} href={figure.href} title={`Open ${figure.label}`}><b>{figure.value}</b>{figure.label}</Link>)}
          <Go href="/targets">Find companies</Go>
        </nav>
      </div>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <section className="ov-nextaction" aria-label="Your next action">
        <Link className="ov-nextaction-main" href={next.href}>
          <div>
            <span className="ov-eyebrow">Your next action</span>
            <h2>{next.title}</h2>
            <p>{next.text}</p>
            <small>{next.meta}</small>
          </div>
          <span className="ov-go is-big">{next.action}<ArrowRight size={20} strokeWidth={2} aria-hidden="true" /></span>
        </Link>
        <div className="home-auto ov-sendline" aria-label="Sending">
          <span className={`ov-dot is-${paused ? "bad" : on ? "ok" : "warn"}`}>{paused ? "Auto-send is paused" : on ? "Auto-send is on" : "Auto-send is off"}</span>
          {sendWindow && <span>{sendWindow}</span>}
          {auto && <span>{auto.plan.sentToday} of {auto.plan.dailyCap} sent today</span>}
          <span className="ov-sendnote">{on ? "Approval doesn't hold an email back. Use Hold on a draft to keep it." : "Nothing sends until auto-send is on."}</span>
          <Go href={`/auto-send?${q}`}>Manage sending</Go>
        </div>
      </section>

      <div className="ov-pair">
        <section id="attention" className="home-card ov-panel home-needs" aria-label="Needs your attention">
          <div className="ov-panel-head"><h2>Needs your attention</h2><Go href={`/replies?${q}`}>View all</Go></div>
          {attention.length ? <Rows rows={attention} /> : <p className="ov-empty"><Inbox size={18} strokeWidth={1.9} aria-hidden="true" />Nothing needs you right now.</p>}
        </section>
        <section className="home-card ov-panel ov-working" aria-label="Nightwatch is working">
          <div className="ov-panel-head"><h2>Nightwatch is working</h2><span className="ov-dot is-ok">Running</span></div>
          <Rows rows={working} />
          <div className="ov-panel-foot"><span>{data.lastListAt ? `Last list ready ${stamp(data.lastListAt)}` : "No list in the last 30 days"}</span><Go href="/activity">View activity</Go></div>
        </section>
      </div>

      <section id="lists" className="home-card ov-panel ov-lists" aria-label="Company lists">
        <div className="ov-panel-head">
          <div><h2>Company lists</h2><p>See progress, results and the next useful action.</p></div>
        </div>
        <div className="ov-lists-tools">
          <div className="ov-tabs" role="tablist" aria-label="Lists">
            <button type="button" role="tab" aria-selected={shelf === "current"} className={shelf === "current" ? "is-on" : ""} onClick={() => setShelf("current")}>Current <span>{current.length}</span></button>
            <button type="button" role="tab" aria-selected={shelf === "archived"} className={shelf === "archived" ? "is-on" : ""} onClick={() => setShelf("archived")}>Done <span>{archived.length}</span></button>
          </div>
          <label className="ov-find"><Search size={15} strokeWidth={2} aria-hidden="true" /><span className="sr-only">Search lists</span><input type="search" placeholder="Search lists" value={find} onChange={(event) => setFind(event.target.value)} /></label>
        </div>
        {shownLists.length
          ? <div className="ov-table" role="table" aria-label="Company lists">
              <div className="ov-tr is-head" role="row"><span role="columnheader">List / audience</span><span role="columnheader">Companies</span><span role="columnheader">Outreach progress</span><span role="columnheader">Results</span><span role="columnheader">Status</span><span role="columnheader">Next action</span></div>
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
          : <p className="ov-empty">{shelf === "current" ? "No current lists. A new one arrives each weeknight." : "No finished lists in the last 30 days."}</p>}
        <div className="ov-panel-foot"><span>Each company counts once, at its furthest step.</span><Go href={`/outreach?list=${owner}`}>Open all companies</Go></div>
      </section>

      <section className="home-card ov-panel home-week ov-results" aria-label="Results">
        <div className="ov-panel-head">
          <h2>Are your lists creating conversations?</h2>
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
