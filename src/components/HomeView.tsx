"use client";

import Link from "next/link";
import { ArrowRight, Bell, Buildings, CaretRight, Check } from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import { CompanyLogo } from "@/components/CompanyLogo";
import type { ListSummary } from "@/lib/company-lists";
import type { HomeData, HomeTodayRow, HomeTodayRows } from "@/lib/home-view";
import type { SeriesDay } from "@/lib/home-stats";
import type { Owner } from "@/lib/types";

type Range = 7 | 14 | 30 | 90;
const RANGES: Range[] = [7, 14, 30, 90];
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const sum = (days: SeriesDay[], key: "sent" | "interested" | "bounced") => days.reduce((total, day) => total + day[key], 0);
const listName = (date: string) => `${new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} list`;

/** The one link style on Overview: words in the accent colour with an arrow that moves on hover. */
const Go = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link className="ov-go" href={href}>{children}<ArrowRight size={15} aria-hidden="true" /></Link>
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

type Lane = { key: string; who: "Night Watch" | "You"; title: string; value: number; unit: string; sub: string; href: string; needs: boolean };
/** A step is one card, or two lanes side by side when email and LinkedIn go different ways. */
type Step = Lane & { lanes?: Lane[] };
type Todo = { key: string; title: string; why: string; href?: string; action?: ReactNode; done?: boolean };

/** One to-do: a number, a check when done, or a dot; the next step gets the Start button. */
function TodoRow({ todo, mark, primary }: { todo: Todo; mark: string; primary: boolean }) {
  const body = <>
    <span className={`ov-num ${mark === "done" ? "is-done" : mark === "dot" ? "is-dot" : ""}`} aria-hidden="true">{mark === "done" ? <Check size={13} weight="bold" /> : mark === "dot" ? null : mark}</span>
    <span className="ov-row-text"><b>{todo.title}</b><small>{todo.why}</small></span>
  </>;
  return (
    <li className={`${primary ? "is-first" : ""} ${todo.done ? "is-done" : ""}`}>
      {todo.href && !todo.action
        ? <Link className="ov-row is-link" href={todo.href}>{body}{primary ? <span className="ov-start">Start<ArrowRight size={14} weight="bold" aria-hidden="true" /></span> : <CaretRight className="ov-chev" size={16} aria-hidden="true" />}</Link>
        : <div className="ov-row">{body}{todo.action && <span className="ov-act">{todo.action}</span>}</div>}
    </li>
  );
}

type TodayKey = keyof HomeTodayRows;
type TodayStat = { key: TodayKey; label: string; value: number; sub: string; empty: string; all: { href: string; label: string } };
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** The rows behind one Today number: who, which company, what happened and when, with the fix or thread right there. */
function TodayList({ stat, rows }: { stat: TodayStat; rows: HomeTodayRow[] }) {
  return (
    <div className="ov-today-panel" role="tabpanel" id={`today-${stat.key}`} aria-labelledby={`today-tab-${stat.key}`}>
      {rows.length === 0 ? <p className="ov-today-empty">{stat.empty}</p> : (
        <ul className="ov-today-list">
          {rows.map((row) => (
            <li key={row.id} className={`is-${row.tone}`}>
              <CompanyLogo domain={row.domain} name={row.company} size={28} />
              <span className="ov-today-who">
                <b>{row.href ? <Link href={row.href}>{row.name || row.company}</Link> : row.name || row.company}{row.name && row.company && <i> · {row.company}</i>}</b>
                <small>{row.note}</small>
              </span>
              <span className="ov-today-side">
                {row.fix && <AddressFix personId={row.fix.personId} current={row.fix.email} label="Fix address" />}
                {row.gmailUrl && <a className="ov-go" href={row.gmailUrl} target="_blank" rel="noreferrer">Reply in Gmail ↗</a>}
                <time dateTime={row.at ?? undefined}>{row.at ? clock(row.at) : row.time ? `About ${row.time}` : ""}</time>
              </span>
            </li>
          ))}
        </ul>
      )}
      <footer><Go href={stat.all.href}>{stat.all.label}</Go></footer>
    </div>
  );
}

/**
 * Overview, read in the morning and shown to anyone new: what happened overnight, how Night Watch works with
 * live numbers at each step, and the short list of what she needs to do, in order, with how long it takes.
 */
export function HomeView({ data, owner, hello, today, quote, aside }: { data: HomeData; owner: Owner; hello: string; today: string; quote: string; aside?: ReactNode }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const d = data.drafts;
  const [range, setRange] = useState<Range>(30);
  const [shelf, setShelf] = useState<"current" | "archived">("current");
  const [picked, setPicked] = useState<TodayKey | null>(null);

  const days = useMemo(() => data.series.slice(-range), [data.series, range]);
  const on = Boolean(auto && !auto.plan.blocker);
  const paused = Boolean(auto?.control.paused);
  const day = auto ? auto.plan.dayLabel.charAt(0).toUpperCase() + auto.plan.dayLabel.slice(1) : "";
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

  // What Night Watch is doing by itself, one row each, with a status word. This is the only place these facts live.
  type Work = { key: string; title: string; meta: string; status: string; tone: "ok" | "run" | "warn" | "bad" | "idle"; href: string };
  const working: Work[] = [
    data.building
      ? { key: "list", title: "Building tonight's list", meta: "Researching companies and writing drafts", status: "Running", tone: "run", href: `/outreach?list=${owner}` }
      : latest
      ? { key: "list", title: `${listName(latest.date)}: ${count(latest.companies, "company", "companies")}`, meta: `${count(latest.progress.ready + latest.progress.review, "email", "emails")} ready${latest.progress.missing ? `, ${latest.progress.missing} finding an address` : ""}`, status: "Ready", tone: "ok", href: `/outreach?list=${owner}` }
      : { key: "list", title: "No new list yet", meta: "A new list arrives each weeknight", status: "Waiting", tone: "idle", href: "/targets" },
    paused
      ? { key: "send", title: "Sending is paused", meta: auto?.control.pausedReason ?? "Review and resume on Auto-send", status: "Paused", tone: "bad", href: `/auto-send?${q}` }
      : on && auto
      ? { key: "send", title: auto.plan.going ? `${count(auto.plan.going, "email", "emails")} ${day === "Today" ? "today" : day}, ${auto.plan.windowLabel}` : `Nothing to send ${day === "Today" ? "today" : day}`, meta: `${auto.plan.sentToday} of ${auto.plan.dailyCap} sent today · ${yesterday} yesterday`, status: "Auto-send on", tone: "ok", href: `/auto-send?${q}` }
      : { key: "send", title: "Auto-send is off", meta: `${count(d.ready + d.review, "email", "emails")} waiting · ${yesterday} sent yesterday`, status: "Auto-send off", tone: "warn", href: `/auto-send?${q}` },
    ...(d.missing || d.checking ? [{ key: "addresses", title: "Finding email addresses", meta: [d.missing && `${d.missing} missing`, d.checking && `${d.checking} awaiting verification`].filter(Boolean).join(", "), status: "Pending", tone: "warn" as const, href: `/drafts?${q}` }] : []),
    { key: "calls", title: data.callsDue ? `${data.callsDue} calls need you` : "Call prep ready", meta: "Next business day after the first email, with phone sources and a script", status: data.callsDue ? "Waiting on you" : "Scheduled", tone: data.callsDue ? "warn" : "ok", href: `/calls?${q}` },
    { key: "followups", title: data.followupsDue ? `${count(data.followupsDue, "follow-up needs", "follow-ups need")} you` : "Follow-ups on schedule", meta: "3 and 10 business days after each first email", status: data.followupsDue ? "Waiting on you" : "Running", tone: data.followupsDue ? "warn" : "run", href: `/followups?view=${data.followupsDue ? "needs" : "upcoming"}&${q}` },
  ];

  const steps: Step[] = [
    { key: "find", who: "Night Watch", title: "Finds companies", value: companies, unit: companies === 1 ? "company on the list" : "companies on the list", sub: latest ? `Newest: ${listName(latest.date)}` : "A new list each weeknight", href: `/outreach?list=${owner}`, needs: false },
    { key: "write", who: "Night Watch", title: "Researches and writes", value: d.total, unit: d.total === 1 ? "email written" : "emails written", sub: `${count(d.linkedinWritten, "LinkedIn message", "LinkedIn messages")} too${d.missing ? ` · ${d.missing} finding an address` : ""}`, href: `/drafts?${q}`, needs: false },
    { key: "review", who: "You", title: on ? "Read if you like" : "Review and approve", value: d.review, unit: "not read yet", sub: on ? "They send either way" : `${d.ready} approved so far`, href: `/drafts?${q}&tab=review`, needs: !on && d.nextUnapproved > 0 },
    { key: "send", who: on ? "Night Watch" : "You", title: "Sends and follows up", value: 0, unit: "", sub: "", href: `/auto-send?${q}`, needs: false, lanes: [
      { key: "email", who: on ? "Night Watch" : "You", title: on ? "Email" : "Email (auto-send off)", value: auto?.plan.going ?? 0, unit: day ? `sending ${day === "Today" ? "today" : day}` : "sending next", sub: on ? `${auto?.plan.sentToday ?? 0} of ${auto?.plan.dailyCap ?? 0} sent today, follow-ups automatic` : "Turn it on and every draft sends itself", href: `/auto-send?${q}`, needs: !on && d.ready > 0 },
      { key: "linkedin", who: "You", title: "LinkedIn, by hand", value: data.linkedin, unit: "ready to send", sub: `Copy, open profile, mark sent · ${data.linkedinSent} sent this week`, href: `/linkedin?${q}`, needs: data.linkedin > 0 },
    ] },
    { key: "reply", who: "You", title: "Replies and meetings", value: data.replies.length, unit: data.replies.length === 1 ? "reply waiting" : "replies waiting", sub: count(data.meetings, "meeting booked", "meetings booked"), href: `/replies?${q}`, needs: data.replies.length > 0 },
  ];

  // The morning routine, always in this order: check the setup, review the emails, then sending.
  const t = data.templates;
  const setupWhy = [
    t?.greeting ? `Emails open with \u201c${t.greeting.replace(/\n[\s\S]*/, "")}\u201d` : "Check how every email opens",
    t?.subject ? `subject \u201c${t.subject}\u201d` : t?.subjectExample ? `each has its own subject, like \u201c${t.subjectExample}\u201d` : "",
  ].filter(Boolean).join(" · ");
  const steps3: Todo[] = [
    { key: "setup", title: "Check the subject, opening and preview", why: `${setupWhy}. See how every email will look before it goes.`, href: `/drafts?${q}#setup`, done: d.total === 0 },
    d.review && on
      ? { key: "review", title: `Read ${count(d.review, "email", "emails")} if you like`, why: `Optional. ${d.nextUnapproved ? `${d.nextUnapproved} of them send ${day === "Today" ? "today" : day}` : "They send"} without approval. Fix or hold back any you don't want to go.`, href: `/drafts?${q}&tab=review`, done: true }
      : d.review
      ? { key: "review", title: `Review ${count(d.review, "email", "emails")}`, why: d.nextUnapproved ? `${d.nextUnapproved} of them send ${day === "Today" ? "today" : day}. Approve each one, fix it or hold it back.` : "Approve each one, fix it or hold it back.", href: `/drafts?${q}&tab=review` }
      : d.ready
      ? { key: "review", title: "Every draft is reviewed", why: d.checking ? `${count(d.ready, "reviewed draft", "reviewed drafts")}. ${count(d.checking, "address needs", "addresses need")} verification before automatic sending.` : `${count(d.ready, "email is", "emails are")} ready to send.`, href: `/drafts?${q}&tab=approved`, done: true }
      : { key: "review", title: "Nothing to review yet", why: d.missing ? `${count(d.missing, "draft is", "drafts are")} waiting on an email address. Night Watch keeps looking.` : "New drafts arrive with each weeknight's list.", href: `/drafts?${q}`, done: true },
    paused
      ? { key: "auto", title: "Resume auto-send", why: auto?.control.pausedReason ? `Paused: ${auto.control.pausedReason.replace(/\.\s*$/, "")}.` : "It is paused. Resume when you are ready.", href: `/auto-send?${q}` }
      : on && auto
      ? { key: "auto", title: "Auto-send is on", why: auto.plan.going ? `Next, ${count(auto.plan.going, "email goes", "emails go")} out ${day === "Today" ? "today" : day}, ${auto.plan.windowLabel} ET. Follow-ups go 3 and 10 business days later, and stop when someone replies.` : `Nothing is queued for ${day === "Today" ? "today" : day} yet. Every draft goes out on its own each weekday morning, approved or not.`, href: `/auto-send?${q}`, done: true }
      : { key: "auto", title: "Turn on auto-send", why: d.ready + d.review ? `${count(d.ready + d.review, "email is", "emails are")} waiting. Once it's on, every draft goes out on its own each weekday morning, no approval needed.` : "Once it's on, every draft goes out on its own each weekday morning, no approval needed.", href: `/auto-send?${q}` },
  ];
  // Anything else waiting on her, shown only when it exists.
  const extras: Todo[] = [
    ...(interested.length ? [{ key: "interested", title: interested.length === 1 ? `Reply to ${interested[0].name}${interested[0].company ? ` at ${interested[0].company}` : ""}` : `Reply to ${interested.length} interested people`, why: "They said yes. Answer while it's fresh.", href: `/replies?${q}` }] : []),
    ...(other ? [{ key: "other", title: `Read ${count(other, "other reply", "other replies")}`, why: "A question or an objection. Decide the next step.", href: `/replies?${q}` }] : []),
    ...data.bounces.slice(0, 3).map((bounce) => ({ key: `b-${bounce.personId}`, title: `${bounce.name} bounced`, why: `${bounce.company}${bounce.email ? `: ${bounce.email} didn't arrive` : ""}.`, action: <AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /> })),
    ...(data.followupsDue ? [{ key: "followups", title: `Send ${count(data.followupsDue, "follow-up", "follow-ups")}`, why: "They came due and couldn't go out by themselves.", href: `/followups?view=needs&${q}` }] : []),
    ...(data.linkedin ? [{ key: "linkedin", title: `Send ${count(data.linkedin, "LinkedIn message", "LinkedIn messages")}`, why: "Copy each one, open the profile, send it there, mark it sent.", href: `/linkedin?${q}` }] : []),
  ];
  const needed = [...steps3.filter((step) => !step.done), ...extras];
  const firstOpen = steps3.find((step) => !step.done)?.key ?? extras[0]?.key;

  const results = [
    { label: "Positive replies", value: sum(days, "interested"), href: `/replies?${q}` },
    { label: "Meetings booked", value: data.meetings, href: "/pipeline" },
    { label: "Emails sent", value: sum(days, "sent"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
    { label: "Bounces", value: sum(days, "bounced"), href: `/drafts/sent?${q}&days=${Math.min(range, 30)}` },
  ];
  const isToday = day === "Today";
  const rows = data.today.rows;
  const queueRows = on && isToday ? rows.queue : [];
  const firstsToday = rows.sent.filter((row) => !row.followup).length;
  const todayStats: TodayStat[] = [
    { key: "sent", label: "Emails sent", value: rows.sent.length, sub: rows.sent.length ? `${firstsToday} first, ${count(rows.sent.length - firstsToday, "follow-up", "follow-ups")}` : "None yet today", empty: "Nothing has gone out yet today.", all: { href: `/drafts/sent?${q}&days=1`, label: "Open Send history" } },
    { key: "queue", label: "Still to send", value: queueRows.length, sub: paused ? "Auto-send is paused" : !on ? "Auto-send is off" : isToday ? `${auto?.plan.windowLabel} ET` : `Next send ${day}`, empty: paused ? "Auto-send is paused, so nothing else goes out today." : !on ? "Auto-send is off, so nothing goes out on its own." : isToday ? "Everything planned for today has gone out." : `Nothing else today. The next send is ${day}.`, all: { href: `/auto-send?${q}`, label: "Open Auto-send" } },
    { key: "replies", label: "Replies in", value: rows.replies.length, sub: data.today.interested ? `${data.today.interested} interested` : "Out-of-office not counted", empty: "No replies yet today. Out-of-office replies are not counted.", all: { href: `/replies?${q}`, label: "Open Replies" } },
    { key: "linkedin", label: "LinkedIn sent", value: rows.linkedin.length, sub: data.linkedin ? `${data.linkedin} ready to send` : "Nothing waiting", empty: data.linkedin ? `Nothing sent yet today. ${count(data.linkedin, "message is", "messages are")} ready.` : "Nothing sent today.", all: { href: `/linkedin?${q}`, label: "Open LinkedIn" } },
    { key: "bounces", label: "Bounces", value: rows.bounces.length, sub: rows.bounces.some((row) => row.fix) ? `${count(rows.bounces.filter((row) => row.fix).length, "address", "addresses")} to fix` : rows.bounces.length ? "All fixed" : "All delivered", empty: "Every email today arrived.", all: { href: `/drafts/sent?${q}&days=1`, label: "Open Send history" } },
  ];
  const openStat = todayStats.find((stat) => stat.key === picked) ?? todayStats.find((stat) => stat.key === "bounces" && rows.bounces.some((row) => row.fix)) ?? todayStats.find((stat) => stat.key === "replies" && stat.value) ?? todayStats.find((stat) => stat.value) ?? todayStats[0];
  const shownLists = shelf === "current" ? current : archived;
  const nextHref = (list: ListSummary) => list.next === "wait" ? null : list.next === "review" ? { href: `/drafts?${q}&tab=review`, label: "Review drafts" } : list.next === "contacts" ? { href: `/outreach?list=${owner}`, label: "Find contacts" } : { href: "/stats", label: "See results" };

  return (
    <div className="home ov">
      <header className="ov-top page-top">
        <nav className="ov-crumbs" aria-label="Where you are"><span>Workspace</span><span aria-hidden="true">/</span><b>Overview</b></nav>
        <div className="ov-top-side">
          {aside}
          <Link className={`ov-bell ${data.replies.length ? "has-dot" : ""}`} href={`/replies?${q}`} aria-label={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "Replies"} title={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"}><Bell size={19} /></Link>
        </div>
      </header>

      <section className="ov-brief" aria-label="Today">
        <div>
          <span className="ov-dateline">{today} <i aria-hidden="true">·</i> Daily briefing</span>
          <h1>{hello}, {data.first}.</h1>
          <p className="ov-summary">{needed.length ? <><b>{count(needed.length, "thing needs", "things need")} you</b> today.</> : <>Nothing needs you right now.</>}</p>
        </div>
        <p className="ov-quote"><i>Today&rsquo;s thought</i><span>{quote}</span></p>
      </section>

      <section className="ov-card ov-today" aria-label="Today so far">
        <header className="ov-card-head"><h2>Today so far</h2><span className="ov-meta">Since midnight, Eastern</span></header>
        <div className="ov-results-row ov-today-row" role="tablist" aria-label="What happened today">
          {todayStats.map((item) => {
            const active = item.key === openStat.key;
            return (
              <button key={item.key} type="button" role="tab" id={`today-tab-${item.key}`} aria-selected={active} aria-controls={`today-${item.key}`}
                className={`ov-result ${active ? "is-active" : ""} ${item.value ? "" : "is-zero"} ${item.key === "bounces" && rows.bounces.some((row) => row.fix) ? "is-warn" : ""}`}
                onClick={() => setPicked(item.key)}>
                <span>{item.label}</span><b>{item.value}</b><small>{item.sub}</small>
              </button>
            );
          })}
        </div>
        <TodayList stat={openStat} rows={openStat.key === "queue" ? queueRows : rows[openStat.key]} />
      </section>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <div className="ov-main">
        <section className="ov-card home-needs ov-todo" aria-label="What you need to do">
          <header className="ov-card-head"><h2>What you need to do</h2><span className="ov-meta">Each morning, in this order</span></header>
          <ol className="ov-todos">
            {steps3.map((todo, index) => <TodoRow key={todo.key} todo={todo} mark={todo.done ? "done" : String(index + 1)} primary={todo.key === firstOpen} />)}
          </ol>
          {extras.length > 0 && <>
            <h3 className="ov-subhead">Also waiting</h3>
            <ul className="ov-todos">
              {extras.map((todo) => <TodoRow key={todo.key} todo={todo} mark="dot" primary={todo.key === firstOpen} />)}
            </ul>
          </>}
        </section>

        <section className="ov-card ov-working" aria-label="Night Watch is working">
          <header className="ov-card-head"><h2>Night Watch is working</h2></header>
          <ul className="ov-work">
            {working.map((item) => (
              <li key={item.key}><Link className="ov-row is-link" href={item.href}>
                <span className="ov-row-text"><b>{item.title}</b><small>{item.meta}</small></span>
                <span className={`ov-status is-${item.tone}`}>{item.status}</span>
              </Link></li>
            ))}
          </ul>
          <footer className="ov-card-foot"><Go href={`/auto-send?${q}`}>Manage sending</Go></footer>
        </section>
      </div>

      <section className="ov-card home-auto ov-flow" aria-label="How Night Watch works">
        <header className="ov-card-head">
          <h2>How Night Watch works</h2>
          <span className="ov-meta">Overnight it finds companies and writes an email and a LinkedIn message for each. You review. Email sends itself; LinkedIn you send by hand.</span>
        </header>
        <ol className="ov-stepper">
          {steps.map((step, index) => {
            const needs = step.lanes ? step.lanes.some((lane) => lane.needs) : step.needs;
            const value = (lane: Lane) => <span className={`ov-step-value ${lane.value ? "" : "is-zero"}`}><b>{lane.value.toLocaleString()}</b> {lane.unit}</span>;
            return (
              <li key={step.key} className={`${needs ? "is-needs" : ""} ${step.lanes ? "is-split" : ""}`}>
                <span className="ov-node" aria-hidden="true">{index + 1}</span>
                {step.lanes ? (
                  <div className="ov-stage">
                    <b className="ov-step-title">{step.title}</b>
                    {step.lanes.map((lane) => (
                      <Link key={lane.key} href={lane.href} className={`ov-lane ${lane.needs ? "is-needs" : ""}`}>
                        <span className="ov-lane-name">{lane.title} <i>{lane.who}</i></span>
                        {value(lane)}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <Link className="ov-stage" href={step.href}>
                    <b className="ov-step-title">{step.title}</b>
                    <span className="ov-owner">{step.who}</span>
                    {value(step)}
                    <small>{step.needs ? "Needs you" : step.sub}</small>
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section id="lists" className="ov-card ov-lists" aria-label="Companies to email">
        <div className="ov-card-head">
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
                  <span role="cell" className="ov-td-next">{action ? <>{action.label}<ArrowRight size={15} aria-hidden="true" /></> : <span className="ov-muted">Being prepared</span>}</span>
                </>;
                return action
                  ? <Link key={list.date} className="ov-tr is-link" role="row" href={action.href}>{cells}</Link>
                  : <div key={list.date} className="ov-tr" role="row">{cells}</div>;
              })}
            </div>
          : <p className="ov-empty"><Buildings size={18} aria-hidden="true" />{shelf === "current" ? "No current lists. A new one arrives each weeknight." : "No finished lists in the last 30 days."}</p>}
        <div className="ov-card-foot"><span>Each company counts once, at its furthest step.</span><Go href={`/outreach?list=${owner}`}>Open all companies</Go></div>
      </section>

      <section className="ov-card home-week ov-results" aria-label="Results">
        <div className="ov-card-head">
          <h2>Is it working?</h2>
          <div className="ov-results-tools">
            <label className="ov-period"><span className="sr-only">Period</span>
              <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>{RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}</select>
            </label>
            <Go href="/stats">Explore results</Go>
          </div>
        </div>
        <div className="ov-results-row">
          {results.map((item) => <Link key={item.label} className={`ov-result ${item.value ? "" : "is-zero"}`} href={item.href}><span>{item.label}</span><b>{item.value}</b><small>{item.label === "Meetings booked" ? "On the calendar now" : `Last ${range} days`}</small></Link>)}
        </div>
        <p className="ov-footnote">Email outcomes. Meetings are what&rsquo;s on the calendar now. LinkedIn sends count once you mark them sent.</p>
      </section>
    </div>
  );
}
