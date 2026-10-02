"use client";

import { useEffect, useState } from "react";

type Skip = { domain: string; reason: string };
type Today = {
  status: string; companies: number; sent: number; held: number; attempts: number; target: number;
  fit: { min: number; median: number; max: number } | null; announcedAt: string | null; summaryPostedAt: string | null;
  skipBuckets: Array<{ bucket: string; count: number }>; skips: Skip[];
};
type Seat = {
  owner: "josh" | "jenna"; autoSend: boolean; paused: boolean; pausedReason: string | null; postalAddressSet: boolean; migrated: boolean;
  safetyMigrated?: boolean; skippedToday?: boolean; dailyCap?: number; daysConnected?: number | null; today: Today | null;
};
type Night = { costUsd: number; budgetUsd: number };

const name = (owner: Seat["owner"]) => (owner === "josh" ? "Josh" : "Suuchi");
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : null);
const RAMP_DAYS = 7;

function buildLine(today: Today) {
  const parts = [`${today.attempts} of ${today.target} evaluated`, `${today.companies} kept${today.fit ? ` (fit ${today.fit.min} to ${today.fit.max}, median ${today.fit.median})` : ""}`, today.status];
  if (today.announcedAt) parts.push(`announced ${time(today.announcedAt)}`);
  if (today.summaryPostedAt) parts.push(`summary ${time(today.summaryPostedAt)}`);
  if (today.sent) parts.push(`${today.sent} sent automatically`);
  if (today.skipBuckets.length) parts.push(`top skips: ${today.skipBuckets.slice(0, 3).map((skip) => `${skip.bucket} ${skip.count}`).join(", ")}`);
  return parts.join(" · ");
}

/** Morning auto-send controls: on/off, pause, skip today, and what tonight's build produced. */
export function AutoSendSettings() {
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [night, setNight] = useState<Night | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/settings/auto-send", { cache: "no-store" }).then((r) => r.json()).then((data) => { if (data.error) setError(data.error); else { setSeats(data.seats); setNight(data.night ?? null); } }).catch(() => setError("Could not load auto-send."));
  }, []);

  async function change(owner: Seat["owner"], patch: { autoSend?: boolean; paused?: boolean; skipToday?: boolean }) {
    setBusy(owner); setError("");
    try {
      const response = await fetch("/api/settings/auto-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, ...patch }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change auto-send.");
      setSeats((current) => current?.map((seat) => (seat.owner === owner ? data.seat : seat)) ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change auto-send."); }
    setBusy("");
  }

  return (
    <section className="feature-center" style={{ marginBottom: 18 }}>
      <h2>Morning list and auto-send</h2>
      <p className="notice">A fresh list of companies is built for each of you overnight, Monday to Friday. Slack announces it at 7:00. With auto-send on, confirmed addresses go out between 9:00 and 11:30 (Eastern), spaced apart; unconfirmed addresses stay on the list for you to send. On Today&apos;s list, &quot;Keep for me&quot; takes one company off auto-send without dismissing it. Auto-send pauses itself after 2 bounces in 48 hours, or when more than 5% of at least 10 first emails bounce. Pause also stops automatic follow-ups; Skip today only skips this morning&apos;s first emails.</p>
      {error && <p className="notice error">{error}</p>}
      {!seats && !error && <p>Loading…</p>}
      {night && <p style={{ margin: "8px 0" }}><strong>Tonight:</strong> ${night.costUsd.toFixed(2)} of ${night.budgetUsd.toFixed(0)} research budget, shared by both lists.</p>}
      {seats?.map((seat) => (
        <div key={seat.owner} className="conn-row" style={{ padding: "10px 0" }}>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ minWidth: 70 }}>{name(seat.owner)}</strong>
            <span>{seat.today ? `Today: ${buildLine(seat.today)}` : "No list yet today"}</span>
            <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={seat.autoSend} disabled={busy === seat.owner || !seat.migrated} onChange={(event) => change(seat.owner, { autoSend: event.target.checked })} />
              Auto-send each morning
            </label>
            {seat.autoSend && <button className="btn" type="button" disabled={busy === seat.owner} onClick={() => change(seat.owner, { paused: !seat.paused })}>{seat.paused ? "Resume" : "Pause"}</button>}
            {seat.autoSend && seat.safetyMigrated && <button className="btn" type="button" disabled={busy === seat.owner} onClick={() => change(seat.owner, { skipToday: !seat.skippedToday })}>{seat.skippedToday ? "Undo skip today" : "Skip today"}</button>}
            {seat.paused && <span className="notice">Paused{seat.pausedReason ? `: ${seat.pausedReason}` : ""}</span>}
            {seat.skippedToday && <span className="notice">No automatic first emails today.</span>}
            {!seat.postalAddressSet && <span className="notice">Add the business postal address above to turn auto-send on.</span>}
            {!seat.migrated && <span className="notice">Run migration 0027 to enable.</span>}
            {seat.migrated && seat.safetyMigrated === false && <span className="notice">Run migration 0030 to enable Skip today and Keep for me.</span>}
          </div>
          {seat.dailyCap !== undefined && <small style={{ display: "block", marginTop: 4 }}>{seat.daysConnected == null ? "Gmail not connected." : `Daily cap today: ${seat.dailyCap} emails (Gmail connected ${seat.daysConnected} ${seat.daysConnected === 1 ? "day" : "days"} ago${seat.daysConnected < RAMP_DAYS ? "; the warm-up limits the morning list until day 7" : ""}).`}</small>}
          {seat.today && seat.today.skips.length > 0 && <details style={{ marginTop: 4 }}>
            <summary>{seat.today.skips.length} skipped {seat.today.skips.length === 1 ? "company" : "companies"}</summary>
            <ul>{seat.today.skips.map((skip, index) => <li key={`${skip.domain}-${index}`}><code>{skip.domain || "build"}</code>: {skip.reason}</li>)}</ul>
          </details>}
        </div>
      ))}
    </section>
  );
}
