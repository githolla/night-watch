"use client";

import { useState } from "react";
import { PanelGuide } from "./PanelGuide";

type Connection = { owner: string; email: string | null; calendar?: boolean | null; connected_at?: string | null };
type GoogleConfig = { clientId: boolean; clientSecret: boolean; redirectUri: string | null; appUrl: string | null };
const SEATS: Array<{ owner: "josh" | "jenna"; label: string }> = [
  { owner: "josh", label: "Seat 1" },
  { owner: "jenna", label: "Seat 2" },
];

/** Connect one Google Workspace account per sending seat. Night Watch sends from the seat a card is assigned
 *  to (chosen with "Send as" on the desk), pulls that seat's replies into the cadence, and proposes meeting
 *  times from its calendar. */
export function Connections({ connections, google }: { connections: Connection[]; google?: GoogleConfig }) {
  const byOwner = new Map(connections.map((row) => [row.owner, row]));
  const [busy, setBusy] = useState<string | null>(null);
  const [flag] = useState(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("connect") : null));
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const ready = google ? Boolean(google.clientId && google.clientSecret && google.redirectUri) : true;
  const suggestedRedirect = google?.redirectUri || `${google?.appUrl || origin || "https://your-app"}/api/gmail/callback`;

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
      <PanelGuide
        what={<>Connects the Google account your emails are actually sent from. Night Watch signs in as that mailbox: outreach leaves from it, replies are read back from it to stop follow-ups the moment someone answers, and its calendar supplies the open slots behind &ldquo;Propose times&rdquo;.</>}
        when={<>Once, at the start &mdash; nothing can send until this is done. Again if you switch mailbox, or if you connected before granting Calendar access and want &ldquo;Propose times&rdquo; to work.</>}
        watch={<>A <strong>seat</strong> is a person who sends. Each one connects their own mailbox, so their emails go out as them, not as you. No password is ever stored &mdash; only an encrypted token Google issues, which you can revoke at any time.</>}
      />
      <header className="conn-head">
        <div><h2>Connected accounts</h2><p>Connect an account per seat. Outreach sends from that seat, replies land back here to drive the cadence, and its calendar powers &ldquo;Propose times&rdquo;.</p></div>
      </header>
      {google && !ready && <div className="google-setup">
        <strong>Finish Google setup to enable sending</strong>
        <p>Create an OAuth client in Google Cloud, then set these on the server. &ldquo;Connect Google&rdquo; stays disabled until all three are present.</p>
        <ul className="google-setup-list">
          <li className={google.clientId ? "ok" : "missing"}><code>GOOGLE_CLIENT_ID</code> {google.clientId ? "set ✓" : "missing"}</li>
          <li className={google.clientSecret ? "ok" : "missing"}><code>GOOGLE_CLIENT_SECRET</code> {google.clientSecret ? "set ✓" : "missing"}</li>
          <li className={google.redirectUri ? "ok" : "missing"}><code>GOOGLE_REDIRECT_URI</code> {google.redirectUri ? "set ✓" : "missing"}</li>
        </ul>
        <p className="google-setup-redirect">Authorized redirect URI to register in Google Cloud (must match exactly):<br /><code>{suggestedRedirect}</code></p>
        <p className="conn-note">On the OAuth consent screen, add scopes: Gmail send, Gmail readonly, and Calendar. External apps need Google&rsquo;s verification for these before non-test users can grant them.</p>
      </div>}
      {flag === "unconfigured" && ready && <p className="notice" role="alert">Google credentials are set but the sign-in was rejected — check the redirect URI matches exactly and the scopes are approved.</p>}
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
                {ready
                  ? <a className="btn primary" href={`/api/gmail/connect?owner=${owner}`}>{connected ? "Reconnect" : "Connect Google"}</a>
                  : <button type="button" className="btn primary" disabled title="Finish Google setup first">Connect Google</button>}
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
