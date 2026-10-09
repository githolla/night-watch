"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutoSendControl, AutoSendEmail, AutoSendSummary } from "@/lib/autosend-view";
import { tally } from "@/lib/send-plan";
import type { Owner } from "@/lib/types";

type Kind = "industry" | "role" | "size";

/**
 * The morning auto-send in plain steps: is it on and what happens next, how it works, who gets emailed in
 * what order, and what it will not send. The order comes from the morning run's own queue, and Keep for me
 * is the card's auto_send_hold, the same switch as the Reach-out list.
 */
export function AutoSendView({ owner, plan, emails, control, canChange, listHref }: { owner: Owner; plan: AutoSendSummary; emails: AutoSendEmail[]; control: AutoSendControl; canChange: boolean; listHref: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<{ kind: Kind; label: string } | null>(null);

  const on = !plan.blocker;
  const paused = control.autoSend && control.paused;
  const matches = (email: AutoSendEmail) => !filter || email[filter.kind] === filter.label;
  const allGoing = emails.filter((email) => email.group === "going");
  const going = allGoing.filter(matches);
  const later = emails.filter((email) => email.group === "later").filter(matches);
  const kept = emails.filter((email) => email.group === "kept");
  const held = emails.filter((email) => email.group === "held");
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /** The same route and rules as Settings: a member changes only their own seat, and on needs a postal address. */
  async function change(body: { autoSend?: boolean; paused?: boolean; skipToday?: boolean }, done: string) {
    setBusy("switch");
    setNotice(null);
    try {
      const response = await fetch("/api/settings/auto-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, ...body }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setNotice({ text: json.error ?? "Could not change auto-send. Try again.", ok: false }); return; }
      setConfirming(false);
      setNotice({ text: done, ok: true });
      router.refresh();
    } catch { setNotice({ text: "Not changed: the connection dropped. Try again.", ok: false }); }
    finally { setBusy(null); }
  }

  async function keep(email: AutoSendEmail, hold: boolean) {
    setBusy(email.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/cards/${email.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto_send_hold: hold }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setNotice({ text: json.error ?? "Not saved. Try again.", ok: false }); return; }
      setNotice({ text: hold ? `${email.company} is kept for you. Auto-send will skip it; you can still send it yourself.` : `${email.company} is back on auto-send.`, ok: true });
      router.refresh();
    } catch { setNotice({ text: "Not saved: the connection dropped. Try again.", ok: false }); }
    finally { setBusy(null); }
  }

  // One sentence: where things stand and what happens next.
  const headline = paused ? `Auto-send is paused${control.pausedReason ? `: ${control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`
    : !control.autoSend ? "Auto-send is off. Nothing goes out unless you send it yourself."
    : !control.postalAddressSet ? "Auto-send is on, but it needs your postal address before anything can go out."
    : control.skippedToday ? `Auto-send is on, but you skipped today.`
    : "Auto-send is on.";
  const next = plan.going === 0
    ? "No emails are waiting. New ones go out each weekday morning as your lists arrive."
    : `${on ? "Next" : "If you turn it on"}: ${count(plan.going, "email goes", "emails go")} out ${plan.dayLabel}, ${plan.windowLabel} Eastern.${plan.later ? ` ${count(plan.later, "more goes", "more go")} out on the send days after that.` : ""}`;

  const switchArea = !canChange ? null : confirming ? (
    <div className="as-confirm" role="group" aria-label="Turn on auto-send">
      <h3>Turn on auto-send?</h3>
      <ul>
        {plan.going > 0
          ? <li><b>{count(plan.going, "email goes", "emails go")} out {plan.dayLabel}</b>, {plan.windowLabel} Eastern, a few minutes apart, from your Gmail. You can see each one below.</li>
          : <li>Nothing is waiting right now. New emails go out each weekday morning as your lists arrive.</li>}
        <li>Then every weekday morning, up to {plan.dailyCap} a day.</li>
        <li>A few unconfirmed addresses may bounce. If too many do, auto-send pauses itself.</li>
        <li>You can turn it off here at any time.</li>
      </ul>
      <div className="as-controls">
        <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void change({ autoSend: true }, "Auto-send is on.")}>{busy === "switch" ? "Turning on…" : "Yes, turn it on"}</button>
        <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>
  ) : (
    <div className="as-controls">
      {paused
        ? <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void change({ paused: false }, "Auto-send is running again.")}>Resume auto-send</button>
        : control.autoSend
          ? <button type="button" role="switch" aria-checked="true" className="as-switch is-on" disabled={busy !== null} onClick={() => void change({ autoSend: false }, "Auto-send is off. Nothing goes out unless you send it.")}><span className="as-knob" />On</button>
          : <button type="button" role="switch" aria-checked="false" className="as-switch" disabled={busy !== null || !control.postalAddressSet} onClick={() => { setNotice(null); setConfirming(true); }}><span className="as-knob" />Off</button>}
      {on && plan.when === "today" && plan.going > 0 && <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void change({ skipToday: true }, "Skipped today. Nothing goes out on its own until the next send day.")}>Skip today</button>}
      {control.autoSend && control.skippedToday && <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void change({ skipToday: false }, "Today is back on.")}>Undo skip today</button>}
      {!control.postalAddressSet && <span className="as-control-note">Add your business postal address in <Link href="/settings">Settings</Link> first. US law requires it.</span>}
    </div>
  );

  const keepButton = (email: AutoSendEmail) => canChange && (email.group === "kept"
    ? <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void keep(email, false)}>{busy === email.id ? "Saving…" : "Let auto-send it"}</button>
    : email.group !== "held" && <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void keep(email, true)}>{busy === email.id ? "Saving…" : "Keep for me"}</button>);

  const row = (email: AutoSendEmail, lead: string, note?: string) => (
    <li key={email.id} className={`as-row is-${email.group}`}>
      <span className="as-time">{lead}</span>
      <span className="as-who"><b>{email.name}</b><small>{email.title || email.role}</small></span>
      <span className="as-company"><Link href={`${listHref}&card=${email.id}`}>{email.company}</Link><small>{note ?? `${email.industry} · ${email.size}`}</small></span>
      <span className="as-action">{keepButton(email)}</span>
    </li>
  );

  const mixFrom = allGoing.length ? allGoing : emails.filter((email) => email.group === "later");
  const mix = (kind: Kind, title: string) => {
    const rows = tally(mixFrom.map((email) => email[kind]));
    const top = Math.max(1, ...rows.map((item) => item.count));
    return (
      <div className="as-mix-card">
        <h3>{title}</h3>
        {rows.map((item) => {
          const active = filter?.kind === kind && filter.label === item.label;
          return (
            <button key={item.label} type="button" className={`as-bar ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setFilter(active ? null : { kind, label: item.label })}>
              <span className="as-bar-label">{item.label}</span>
              <span className="as-bar-track"><span style={{ width: `${Math.round((item.count / top) * 100)}%` }} /></span>
              <b>{item.count}</b>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="autosend-page">
      <section className={`as-status-card ${on ? "is-on" : paused ? "is-paused" : "is-off"}`} aria-label="Auto-send status">
        <p className="as-headline">{headline}</p>
        <p className="as-next">{next}</p>
        {switchArea}
        <p className="as-today">Sent today: <b>{plan.sentToday} of {plan.dailyCap}</b> · <Link href={`/drafts/sent?owner=${owner}&days=1`}>See what was sent &rarr;</Link></p>
      </section>

      {notice && <p className={`as-notice ${notice.ok ? "is-ok" : "is-bad"}`} role="status">{notice.text}</p>}

      <section className="as-tiles" aria-label="At a glance">
        <div className="as-tile is-main"><span>{on ? "Going out" : "Would go out"} {plan.dayLabel}</span><b>{plan.going}</b><small>{plan.windowLabel} Eastern</small></div>
        <div className="as-tile"><span>Sent today</span><b>{plan.sentToday}</b><small>of {plan.dailyCap} a day</small></div>
        <div className="as-tile"><span>After that</span><b>{plan.later}</b><small>over the daily limit</small></div>
        <div className="as-tile"><span>Kept for you</span><b>{kept.length}</b><small>you send these yourself</small></div>
        <div className={`as-tile ${held.length ? "is-warn" : ""}`}><span>Needs you</span><b>{held.length}</b><small>auto-send can&rsquo;t send these</small></div>
      </section>

      {mixFrom.length > 0 && (
        <section className="as-mix" aria-label="Who gets them">
          <div className="as-queue-head"><h2>Who gets them</h2><p>Click a bar to see just those emails below.</p></div>
          <div className="as-mix-grid">
            {mix("industry", "Industry")}
            {mix("role", "Who it goes to")}
            {mix("size", "Company size")}
          </div>
        </section>
      )}

      {filter && <p className="as-filter">Showing <b>{filter.label}</b> only. <button type="button" className="btn ghost" onClick={() => setFilter(null)}>Show all</button></p>}

      <section className="as-how" aria-label="How auto-send works">
        <div><b>Every weekday morning</b><span>Between 9:00 and 11:30am Eastern, from your own Gmail, a few minutes apart.</span></div>
        <div><b>Up to {plan.dailyCap} a day</b><span>Anything over that goes out on the next send day. Follow-ups stop when someone replies.</span></div>
        <div><b>You stay in control</b><span>Press <i>Keep for me</i> on any email to send it yourself, or skip a day. It pauses itself if emails bounce.</span></div>
      </section>

      <section className="as-queue" aria-label="Who gets emailed next">
        <div className="as-queue-head"><h2>Who gets emailed {plan.dayLabel} <span>{going.length}</span></h2><p>{on ? "In this order." : "In this order, once auto-send is on."} Click a company to read or change its email.</p></div>
        {going.length
          ? <ol className="as-list">{going.map((email) => row(email, email.time ?? `#${email.position}`))}</ol>
          : <p className="as-empty">Nobody is waiting for {plan.dayLabel}.</p>}
      </section>

      {later.length > 0 && (
        <section className="as-queue" aria-label="After that">
          <div className="as-queue-head"><h2>After that <span>{later.length}</span></h2><p>Over the daily limit of {plan.dailyCap}, so these go out on the next send days, in this order.</p></div>
          <ol className="as-list">{later.map((email) => row(email, `#${email.position}`))}</ol>
        </section>
      )}

      {(kept.length > 0 || held.length > 0) && (
        <section className="as-queue" aria-label="Not sending">
          <div className="as-queue-head"><h2>Auto-send won&rsquo;t send these <span>{kept.length + held.length}</span></h2><p>Send them yourself from the Reach-out list.</p></div>
          <ol className="as-list">
            {kept.map((email) => row(email, "Kept for you"))}
            {held.map((email) => row(email, "Needs you", email.reason ? `Why: ${email.reason}` : undefined))}
          </ol>
        </section>
      )}

    </div>
  );
}
