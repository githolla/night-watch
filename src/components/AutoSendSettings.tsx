"use client";

import { useEffect, useState } from "react";

type Seat = { owner: "josh" | "jenna"; autoSend: boolean; paused: boolean; pausedReason: string | null; postalAddressSet: boolean; migrated: boolean; today: { status: string; companies: number; sent: number; held: number } | null };

const name = (owner: Seat["owner"]) => (owner === "josh" ? "Josh" : "Suuchi");

/** Morning auto-send controls: on/off, pause, and what today's list looks like. */
export function AutoSendSettings() {
  const [seats, setSeats] = useState<Seat[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/settings/auto-send", { cache: "no-store" }).then((r) => r.json()).then((data) => { if (data.error) setError(data.error); else setSeats(data.seats); }).catch(() => setError("Could not load auto-send."));
  }, []);

  async function change(owner: Seat["owner"], patch: { autoSend?: boolean; paused?: boolean }) {
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
      <p className="notice">A fresh list of companies is built for each of you overnight. Slack announces it at 7:00. With auto-send on, confirmed addresses go out between 9:00 and 11:30 (Eastern), spaced apart; unconfirmed addresses stay on the list for you to send. Auto-send pauses itself if more than 5% of the day&apos;s emails bounce.</p>
      {error && <p className="notice error">{error}</p>}
      {!seats && !error && <p>Loading…</p>}
      {seats?.map((seat) => (
        <div key={seat.owner} className="conn-row" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", padding: "10px 0" }}>
          <strong style={{ minWidth: 70 }}>{name(seat.owner)}</strong>
          <span>{seat.today ? `Today: ${seat.today.companies} companies (${seat.today.status})${seat.today.sent ? `, ${seat.today.sent} sent automatically` : ""}` : "No list yet today"}</span>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={seat.autoSend} disabled={busy === seat.owner || !seat.migrated} onChange={(event) => change(seat.owner, { autoSend: event.target.checked })} />
            Auto-send each morning
          </label>
          {seat.autoSend && <button className="btn" type="button" disabled={busy === seat.owner} onClick={() => change(seat.owner, { paused: !seat.paused })}>{seat.paused ? "Resume" : "Pause"}</button>}
          {seat.paused && <span className="notice">Paused{seat.pausedReason ? `: ${seat.pausedReason}` : ""}</span>}
          {!seat.postalAddressSet && <span className="notice">Add the business postal address above to turn auto-send on.</span>}
          {!seat.migrated && <span className="notice">Run migration 0027 to enable.</span>}
        </div>
      ))}
    </section>
  );
}
