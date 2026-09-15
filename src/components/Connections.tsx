"use client";

import { useState } from "react";

type Connection = { owner: string; email: string | null; calendar?: boolean | null; connected_at?: string | null };

/** Connect the sending Google Workspace account so Night Watch can send from it, read replies for the
 *  cadence, and propose meeting times from its calendar. */
export function Connections({ connections }: { connections: Connection[] }) {
  const row = connections.find((item) => item.owner === "josh") ?? connections[0] ?? null;
  const connected = Boolean(row);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    if (!confirm("Disconnect Google? Sending and reply capture will stop until you reconnect.")) return;
    setBusy(true);
    try {
      await fetch("/api/gmail/disconnect", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      window.location.reload();
    } finally { setBusy(false); }
  }

  return (
    <section className="conn-card">
      <header className="conn-head">
        <div><h2>Google Workspace</h2><p>Connect the account outreach is sent from. Night Watch sends through it, pulls replies into the cadence, and proposes meeting times from its calendar.</p></div>
      </header>
      <div className="conn-list">
        <div className={`conn-row ${connected ? "is-on" : ""}`}>
          <div className="conn-who">
            <span className={`conn-dot ${connected ? "is-on" : ""}`} />
            <div>
              <strong>Sending account</strong>
              <small>{connected ? row!.email ?? "connected" : "Not connected"}</small>
            </div>
          </div>
          <div className="conn-scopes">
            {connected && <><em className="conn-chip is-on">Send</em><em className="conn-chip is-on">Replies</em><em className={`conn-chip ${row!.calendar ? "is-on" : ""}`}>{row!.calendar ? "Calendar" : "No calendar"}</em></>}
          </div>
          <div className="conn-actions">
            <a className="btn primary" href="/api/gmail/connect">{connected ? "Reconnect" : "Connect Google"}</a>
            {connected && <button type="button" className="btn ghost danger" disabled={busy} onClick={disconnect}>Disconnect</button>}
          </div>
        </div>
      </div>
      <p className="conn-note">OAuth only — an encrypted refresh token is stored, never a password. Requires Google Cloud credentials (client ID/secret + redirect URI) on the server, with Gmail send/read and Calendar approved on the consent screen. Reconnect if you add Calendar so &ldquo;Propose times&rdquo; can read your availability.</p>
    </section>
  );
}
