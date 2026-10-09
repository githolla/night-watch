"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutoSendEmail, AutoSendSummary } from "@/lib/autosend-view";
import { tally } from "@/lib/send-plan";

type Kind = "industry" | "role" | "size" | "address";
const addressOf = (email: AutoSendEmail) => (email.confirmed ? "Confirmed" : "Unconfirmed");
const valueOf = (email: AutoSendEmail, kind: Kind) => (kind === "address" ? addressOf(email) : email[kind]);

/**
 * What the morning auto-send sends next, laid out from its own queue: how many and when, who they go to, and
 * the order. Keep for me takes one off; it uses the card's auto_send_hold, the same switch as the Reach-out list.
 */
export function AutoSendView({ plan, emails, listHref }: { plan: AutoSendSummary; emails: AutoSendEmail[]; listHref: string }) {
  const router = useRouter();
  const [filter, setFilter] = useState<{ kind: Kind; label: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);

  const going = emails.filter((email) => email.group === "going");
  const mixFrom = going.length ? going : emails.filter((email) => email.group === "later");
  const matches = (email: AutoSendEmail) => !filter || valueOf(email, filter.kind) === filter.label;
  const group = (name: AutoSendEmail["group"]) => emails.filter((email) => email.group === name && matches(email));
  const kept = emails.filter((email) => email.group === "kept").length;
  const on = !plan.blocker;

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
          <span className={`as-status ${on ? "is-on" : ""}`}>{on ? "Auto-send is on" : plan.blocker}</span>
          <p className="as-big"><b>{plan.going}</b> {plan.going === 1 ? "email" : "emails"} {on ? "go out" : "would go out"} {plan.dayLabel}</p>
          <p className="as-when">{plan.windowLabel} Eastern, a few minutes apart, from your own Gmail.</p>
          {!on && <p className="as-off">Nothing goes out on its own until auto-send is on. <Link href={listHref}>Turn it on from the Reach-out list &rarr;</Link></p>}
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
