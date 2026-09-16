"use client";

import { useState } from "react";

type Connection = { owner: string; email: string | null; calendar?: boolean | null; connected_at?: string | null };
const SEATS: Array<{ owner: "josh" | "jenna"; label: string }> = [
  { owner: "josh", label: "Seat 1" },
  { owner: "jenna", label: "Seat 2" },
];

/** Connect one Google Workspace account per sending seat. Night Watch sends from the seat a card is assigned
 *  to (chosen with "Send as" on the desk), pulls that seat's replies into the cadence, and proposes meeting
 *  times from its calendar. */
export function Connections({ connections }: { connections: Connection[] }) {
  const byOwner = new Map(connections.map((row) => [row.owner, row]));
  const [busy, setBusy] = useState<string | null>(null);
  const [flag] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("connect") : null));

  async function disconnect(owner: string, label: string) {
    if (!confirm(`Disconnect Google for ${label}? Sending and reply capture stop for it until reconnected.`)) return;
    setBusy(owner);
    try {
      await fetch("/api/gmail/disconnect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }) });
      window.location.reload();
    } finally { setBusy(null); }
  }

  return (
    <section className="conn-card">
      <header className="conn-head">
        <div><h2>Google Workspace seats</h2><p>Connect an account per seat. Outreach sends from that seat, replies land back here to drive the cadence, and its calendar powers &ldquo;Propose times&rdquo;.</p></div>
      </header>
      {flag === "unconfigured" && <p className="notice" role="alert">Google sign-in isn&rsquo;t set up on the server yet. An admin needs to add the Google Cloud OAuth credentials (<code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code>, <code>GOOGLE_REDIRECT_URI</code>) and approve the Gmail + Calendar scopes on the consent screen. Until then &ldquo;Connect Google&rdquo; can&rsquo;t start.</p>}
      <div className="conn-list">
        {SEATS.map(({ owner, label }) => {
          const row = byOwner.get(owner);
          const connected = Boolean(row);
          return (
            <div key={owner} className={`conn-row ${connected ? "is-on" : ""}`}>
              <div className="conn-who">
                <span className={`conn-dot ${connected ? "is-on" : ""}`} />
                <div>
                  <strong>{label}</strong>
                  <small>{connected ? row!.email ?? "connected" : "Not connected"}</small>
                </div>
              </div>
              <div className="conn-scopes">
                {connected && <><em className="conn-chip is-on">Send</em><em className="conn-chip is-on">Replies</em><em className={`conn-chip ${row!.calendar ? "is-on" : ""}`}>{row!.calendar ? "Calendar" : "No calendar"}</em></>}
              </div>
              <div className="conn-actions">
                <a className="btn primary" href={`/api/gmail/connect?owner=${owner}`}>{connected ? "Reconnect" : "Connect Google"}</a>
                {connected && <button type="button" className="btn ghost danger" disabled={busy === owner} onClick={() => disconnect(owner, label)}>Disconnect</button>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="conn-note">OAuth only — an encrypted refresh token is stored per seat, never a password. Requires Google Cloud credentials (client ID/secret + redirect URI) on the server, with Gmail send/read and Calendar approved on the consent screen. Reconnect a seat after adding Calendar so &ldquo;Propose times&rdquo; can read its availability.</p>
    </section>
  );
}
