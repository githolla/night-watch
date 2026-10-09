"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutoSendControl, AutoSendEmail, AutoSendSummary } from "@/lib/autosend-view";
import type { Owner } from "@/lib/types";
import { tally } from "@/lib/send-plan";

type Kind = "industry" | "role" | "size" | "address";
const addressOf = (email: AutoSendEmail) => (email.confirmed ? "Confirmed" : "Unconfirmed");
const valueOf = (email: AutoSendEmail, kind: Kind) => (kind === "address" ? addressOf(email) : email[kind]);

/**
 * What the morning auto-send sends next, laid out from its own queue: how many and when, who they go to, and
 * the order. Keep for me takes one off; it uses the card's auto_send_hold, the same switch as the Reach-out list.
 */
export function AutoSendView({ owner, plan, emails, control, canChange, listHref }: { owner: Owner; plan: AutoSendSummary; emails: AutoSendEmail[]; control: AutoSendControl; canChange: boolean; listHref: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [filter, setFilter] = useState<{ kind: Kind; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const going = emails.filter((email) => email.group === "going");
  const mixFrom = going.length ? going : emails.filter((email) => email.group === "later");
  const matches = (email: AutoSendEmail) => !filter || valueOf(email, filter.kind) === filter.label;
  const group = (name: AutoSendEmail["group"]) => emails.filter((email) => email.group === name && matches(email));
  const kept = emails.filter((email) => email.group === "kept").length;
  const on = !plan.blocker;
  const paused = control.autoSend && control.paused;

  /** The same route and rules as Settings: a member changes only their own seat, and on needs a postal address. */
  async function change(body: { autoSend?: boolean; paused?: boolean; skipToday?: boolean }, done: string) {
    setSwitching(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/auto-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, ...body }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setNotice({ text: json.error ?? "Could not change auto-send. Try again.", ok: false }); return; }
      setConfirming(false);
      setNotice({ text: done, ok: true });
      router.refresh();
    } catch { setNotice({ text: "Not changed: the connection dropped. Try again.", ok: false }); }
    finally { setSwitching(false); }
  }

  const controls = !canChange ? null : confirming ? (
    <div className="as-confirm" role="group" aria-label="Turn on auto-send">
      <h3>Turn on auto-send?</h3>
      <ul>
        {plan.going > 0
          ? <li><b>{plan.going} {plan.going === 1 ? "email goes" : "emails go"} out {plan.dayLabel}</b>, {plan.windowLabel} Eastern, a few minutes apart, from your Gmail. They are listed below, in order.</li>
          : <li>Nothing is waiting right now. New emails go out each weekday morning, {plan.windowLabel} Eastern, as lists arrive.</li>}
        <li>Then every weekday morning, up to {plan.dailyCap} a day. Anything over that waits for the next day.</li>
        <li>Unconfirmed addresses go too, so a few may bounce. Auto-send pauses itself if bounces pile up.</li>
        <li>Use <b>Keep for me</b> on any email you want to send yourself. You can turn it off here at any time.</li>
      </ul>
      <div className="as-controls">
        <button type="button" className="btn primary" disabled={switching} onClick={() => void change({ autoSend: true }, "Auto-send is on.")}>{switching ? "Turning on…" : "Yes, turn it on"}</button>
        <button type="button" className="btn ghost" disabled={switching} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>
  ) : (
    <div className="as-controls">
      {paused
        ? <button type="button" className="btn primary" disabled={switching} onClick={() => void change({ paused: false }, "Auto-send is running again.")}>Resume auto-send</button>
        : control.autoSend
          ? <button type="button" role="switch" aria-checked="true" className="as-switch is-on" disabled={switching} onClick={() => void change({ autoSend: false }, "Auto-send is off. Nothing goes out unless you send it.")}><span className="as-knob" />On</button>
          : <button type="button" role="switch" aria-checked="false" className="as-switch" disabled={switching || !control.postalAddressSet} onClick={() => { setNotice(null); setConfirming(true); }}><span className="as-knob" />Off</button>}
      {on && plan.when === "today" && plan.going > 0 && <button type="button" className="btn ghost" disabled={switching} onClick={() => void change({ skipToday: true }, "Skipped today. Nothing goes out on its own until the next send day.")}>Skip today</button>}
      {control.autoSend && control.skippedToday && <button type="button" className="btn ghost" disabled={switching} onClick={() => void change({ skipToday: false }, "Today is back on.")}>Undo skip today</button>}
      {!control.autoSend && !control.postalAddressSet && <span className="as-control-note">Add your business postal address in <Link href="/settings">Settings</Link> first. US law requires it.</span>}
    </div>
  );

  async function keep(email: AutoSendEmail, hold: boolean) {
    setBusy(email.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/cards/${email.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto_send_hold: hold }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setNotice({ text: json.error ?? "Not saved. Try again.", ok: false }); return; }
      setNotice({ text: hold ? `${email.company} is kept for you: auto-send skips it. You can still send it yourself.` : `${email.company} is back on auto-send.`, ok: true });
      router.refresh();
    } catch { setNotice({ text: "Not saved: the connection dropped. Try again.", ok: false }); }
    finally { setBusy(null); }
  }

  const mix = (kind: Kind, title: string) => {
    const rows = tally(mixFrom.map((email) => valueOf(email, kind)));
    const top = Math.max(1, ...rows.map((row) => row.count));
    return (
      <div className="as-mix-card">
        <h3>{title}</h3>
        {rows.map((row) => {
          const active = filter?.kind === kind && filter.label === row.label;
          return (
            <button key={row.label} type="button" className={`as-bar ${active ? "is-active" : ""}`} aria-pressed={active} onClick={() => setFilter(active ? null : { kind, label: row.label })}>
              <span className="as-bar-label">{row.label}</span>
              <span className="as-bar-track"><span style={{ width: `${Math.round((row.count / top) * 100)}%` }} /></span>
              <b>{row.count}</b>
            </button>
          );
        })}
      </div>
    );
  };

  const row = (email: AutoSendEmail) => (
    <li key={email.id} className={`as-row is-${email.group}`}>
      <span className="as-pos">{email.group === "going" || email.group === "later" ? `#${email.position}` : ""}</span>
      <span className="as-time">{email.group === "going" ? email.time : email.group === "later" ? "Later day" : email.group === "kept" ? "Kept" : "Held"}</span>
      <span className="as-who"><b>{email.name}</b><small>{email.title || email.role}</small></span>
      <span className="as-company"><Link href={`${listHref}&card=${email.id}`}>{email.company}</Link><small>{email.reason ?? `${email.industry} · ${email.size}`}</small></span>
      <span className={`address-badge ${email.confirmed ? "is-confirmed" : "is-unconfirmed"}`}>{addressOf(email)}</span>
      <span className="as-action">
        {email.group === "kept"
          ? <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void keep(email, false)}>{busy === email.id ? "Saving…" : "Let auto-send it"}</button>
          : email.group !== "held" && <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void keep(email, true)}>{busy === email.id ? "Saving…" : "Keep for me"}</button>}
      </span>
    </li>
  );

  const section = (name: AutoSendEmail["group"], title: string, hint: string) => {
    const items = group(name);
    if (!items.length) return null;
    return (
      <section className="as-queue" aria-label={title}>
        <div className="as-queue-head"><h2>{title} <span>{items.length}</span></h2><p>{hint}</p></div>
        <ol className="as-list">{items.map(row)}</ol>
      </section>
    );
  };

  return (
    <div className="autosend-page">
      <section className={`as-hero ${on ? "is-on" : "is-off"}`} aria-label="What goes out next">
        <div className="as-hero-main">
          <span className={`as-status ${on ? "is-on" : ""}`}>{on ? (control.skippedToday ? "Auto-send is on · skipped today" : "Auto-send is on") : paused ? `Paused${control.pausedReason ? `: ${control.pausedReason.replace(/\.\s*$/, "")}` : ""}` : plan.blocker}</span>
          <p className="as-big"><b>{plan.going}</b> {plan.going === 1 ? "email" : "emails"} {on ? "go out" : "would go out"} {plan.dayLabel}</p>
          <p className="as-when">{plan.windowLabel} Eastern, a few minutes apart, from your own Gmail.{!on && " Nothing goes out on its own while auto-send is off."}</p>
          {controls}
        </div>
        <dl className="as-stats">
          <div><dt>Sent today</dt><dd>{plan.sentToday} <small>of {plan.dailyCap} a day</small></dd></div>
          <div><dt>Wait for a later day</dt><dd>{plan.later}</dd></div>
          <div><dt>Held back</dt><dd>{plan.held}</dd></div>
          <div><dt>Kept for you</dt><dd>{kept}</dd></div>
        </dl>
      </section>

      {notice && <p className={`as-notice ${notice.ok ? "is-ok" : "is-bad"}`} role="status">{notice.text}</p>}

      {mixFrom.length > 0 && (
        <section className="as-mix" aria-label="Who gets them">
          <div className="as-queue-head"><h2>Who gets them</h2><p>Click a bar to see just those emails below.</p></div>
          <div className="as-mix-grid">
            {mix("industry", "Industry")}
            {mix("role", "Who it goes to")}
            {mix("size", "Company size")}
            {mix("address", "Email address")}
          </div>
        </section>
      )}

      {filter && <p className="as-filter">Showing <b>{filter.label}</b> only. <button type="button" className="btn ghost" onClick={() => setFilter(null)}>Show all</button></p>}

      {emails.length === 0 && <p className="as-empty">Nothing is waiting for auto-send. New emails arrive with tonight&rsquo;s list.</p>}
      {section("going", `Going out ${plan.dayLabel}`, "In this order. Click a company to read or edit its email on the Reach-out list.")}
      {section("later", "Waiting for a later day", "Over the daily limit; they go out on the next send days, in this order.")}
      {section("held", "Held back", "Auto-send skips these. Send them yourself once the reason is fixed.")}
      {section("kept", "Kept for you", "You chose to send these yourself.")}
    </div>
  );
}
