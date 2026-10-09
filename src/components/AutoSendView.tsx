"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReviewSender } from "@/components/DraftReview";
import type { AutoSendControl, AutoSendEmail, AutoSendSummary } from "@/lib/autosend-view";
import { outreachBody, outreachEmailHtml } from "@/lib/outreach-ending";
import { tally } from "@/lib/send-plan";
import type { Owner } from "@/lib/types";

type Kind = "industry" | "role" | "size";
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Outside the ICP: sized over the top of the revenue band. */
const OUT_OF_RANGE = "Over $100M";

/**
 * The morning auto-send in plain steps: is it on and what happens next, how it works, who gets emailed in
 * what order, and what it will not send. The order comes from the morning run's own queue, and Keep for me
 * is the card's auto_send_hold, the same switch as the Reach-out list.
 */
export function AutoSendView({ owner, plan, emails, control, canChange, listHref, sender, optOut }: { owner: Owner; plan: AutoSendSummary; emails: AutoSendEmail[]; control: AutoSendControl; canChange: boolean; listHref: string; sender: ReviewSender; optOut: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<{ kind: Kind; label: string } | null>(null);
  // One email open at a time, read-only as it will be sent unless Edit is pressed.
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; subject: string; body: string; updatedAt: string } | null>(null);
  const [rowNote, setRowNote] = useState<{ id: string; text: string; ok: boolean; conflict?: boolean } | null>(null);

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

  const outOfRange = emails.filter((email) => (email.group === "going" || email.group === "later") && email.size === OUT_OF_RANGE);
  async function keepOutOfRange() {
    setBusy("range");
    setNotice(null);
    let kept = 0;
    for (const email of outOfRange) {
      const response = await fetch(`/api/cards/${email.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto_send_hold: true }) }).catch(() => null);
      if (response?.ok) kept += 1;
    }
    setBusy(null);
    setNotice({ text: kept === outOfRange.length ? `Kept ${kept} for you. Auto-send will skip companies over $100M; you can still send them yourself.` : `Kept ${kept} of ${outOfRange.length}. Try again for the rest.`, ok: kept === outOfRange.length });
    router.refresh();
  }

  // The email as the recipient will get it: the same body transform, signature, postal line and opt-out.
  const emailHtml = (email: AutoSendEmail, body: string) => `${outreachEmailHtml(email.curated ? outreachBody(body) : body, sender)}${email.curated ? "" : `<p style="font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b645a">${escapeHtml(optOut)}</p>`}`;

  async function saveEdit(email: AutoSendEmail) {
    if (!editing) return;
    if (!editing.subject.trim() || !editing.body.trim()) { setRowNote({ id: email.id, text: "An email needs a subject and a message.", ok: false }); return; }
    setBusy(email.id);
    try {
      const response = await fetch(`/api/cards/${email.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email_subject: editing.subject, email_body: editing.body, expected_updated_at: editing.updatedAt }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setRowNote({ id: email.id, text: response.status === 409 ? "Not saved: this email was changed somewhere else (or sent) since you opened it. Your text is still here." : json.error ?? "Not saved. Try again.", ok: false, conflict: response.status === 409 });
        return;
      }
      setEditing(null);
      setRowNote({ id: email.id, text: "Saved. This is what auto-send will send.", ok: true });
      router.refresh();
    } catch { setRowNote({ id: email.id, text: "Not saved: the connection dropped. Your text is still here.", ok: false }); }
    finally { setBusy(null); }
  }

  async function loadSaved(email: AutoSendEmail) {
    const response = await fetch(`/api/cards/${email.id}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({})) as { email_subject?: string | null; email_body?: string | null; updated_at?: string };
    if (!response.ok || !json.updated_at) { setRowNote({ id: email.id, text: "Could not load the saved version.", ok: false, conflict: true }); return; }
    setEditing({ id: email.id, subject: json.email_subject ?? "", body: json.email_body ?? "", updatedAt: json.updated_at });
    setRowNote({ id: email.id, text: "Showing the saved version. Edit it and save again if you like.", ok: true });
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

  const toggle = (email: AutoSendEmail) => { setOpenId(openId === email.id ? null : email.id); setEditing(null); setRowNote(null); };
  const row = (email: AutoSendEmail, lead: string, note?: string) => {
    const open = openId === email.id;
    const edit = editing?.id === email.id ? editing : null;
    const rowMessage = rowNote?.id === email.id ? rowNote : null;
    return (
      <li key={email.id} className={`as-item ${open ? "is-open" : ""}`}>
        <div className={`as-row is-${email.group}`}>
          <span className="as-time">{lead}</span>
          <button type="button" className="as-who as-open" aria-expanded={open} onClick={() => toggle(email)}><b>{email.name}</b><small>{email.title || email.role}</small></button>
          <button type="button" className="as-company as-open" aria-expanded={open} onClick={() => toggle(email)}><b>{email.company}</b><small>{note ?? `${email.industry} · ${email.size}`}</small></button>
          <span className="as-action"><button type="button" className="btn ghost" onClick={() => toggle(email)}>{open ? "Close" : "Read"}</button>{keepButton(email)}</span>
        </div>
        {open && (
          <div className="as-email">
            <p className="as-email-to">To {email.name}{email.email ? ` · ${email.email}` : " · no address on file"}</p>
            {edit ? (
              <div className="as-email-edit">
                <label><span>Subject</span><input value={edit.subject} maxLength={120} aria-label="Edit subject" onChange={(event) => setEditing({ ...edit, subject: event.target.value })} /></label>
                <label><span>Message</span><textarea rows={11} maxLength={1000} value={edit.body} aria-label="Edit message" onChange={(event) => setEditing({ ...edit, body: event.target.value })} /></label>
                <div className="as-controls">
                  <button type="button" className="btn primary" disabled={busy !== null} onClick={() => void saveEdit(email)}>{busy === email.id ? "Saving…" : "Save"}</button>
                  <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => { setEditing(null); setRowNote(null); }}>Cancel</button>
                  {rowMessage?.conflict && <button type="button" className="btn" onClick={() => void loadSaved(email)}>Load the saved version</button>}
                </div>
              </div>
            ) : (
              <>
                <h3 className="as-email-subject">{email.subject || "No subject"}</h3>
                <div className="review-email" dangerouslySetInnerHTML={{ __html: emailHtml(email, email.body) }} />
                <div className="as-controls">
                  {canChange && <button type="button" className="btn" disabled={busy !== null} onClick={() => { setEditing({ id: email.id, subject: email.subject, body: email.body, updatedAt: email.updatedAt }); setRowNote(null); }}>Edit</button>}
                  <Link className="review-open" href={`${listHref}&card=${email.id}`}>Open on the Reach-out list &rarr;</Link>
                </div>
              </>
            )}
            {rowMessage && <p className={`as-notice ${rowMessage.ok ? "is-ok" : "is-bad"}`} role="status">{rowMessage.text}</p>}
          </div>
        )}
      </li>
    );
  };

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

      {canChange && outOfRange.length > 0 && (
        <p className="as-range">
          <span><b>{outOfRange.length} {outOfRange.length === 1 ? "company is" : "companies are"} over $100M</b>, outside your range.</span>
          <button type="button" className="btn" disabled={busy !== null} onClick={() => void keepOutOfRange()}>{busy === "range" ? "Keeping…" : `Keep ${outOfRange.length === 1 ? "it" : "these"} for me`}</button>
        </p>
      )}

      {filter && <p className="as-filter">Showing <b>{filter.label}</b> only. <button type="button" className="btn ghost" onClick={() => setFilter(null)}>Show all</button></p>}

      <section className="as-how" aria-label="How auto-send works">
        <div><b>Every weekday morning</b><span>Between 9:00 and 11:30am Eastern, from your own Gmail, a few minutes apart.</span></div>
        <div><b>Up to {plan.dailyCap} a day</b><span>Anything over that goes out on the next send day. Follow-ups stop when someone replies.</span></div>
        <div><b>You stay in control</b><span>Press <i>Keep for me</i> on any email to send it yourself, or skip a day. It pauses itself if emails bounce.</span></div>
      </section>

      <section className="as-queue" aria-label="Who gets emailed next">
        <div className="as-queue-head"><h2>Who gets emailed {plan.dayLabel} <span>{going.length}</span></h2><p>{on ? "In this order." : "In this order, once auto-send is on."} Click anyone to read their email as it will be sent, or change it.</p></div>
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
