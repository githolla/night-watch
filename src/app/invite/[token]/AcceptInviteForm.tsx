"use client";

import { useState } from "react";

export function AcceptInviteForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) { setMessage("Those passwords don't match."); return; }
    if (password.length < 8) { setMessage("Use at least 8 characters."); return; }
    setLoading(true); setMessage("");
    const response = await fetch("/api/auth/accept-invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) });
    const result = await response.json();
    if (!response.ok) { setLoading(false); setMessage(result.error ?? "Could not set your password."); return; }
    window.location.replace("/settings?welcome=1");
  }

  return <form className="password-form" onSubmit={submit}>
    <label htmlFor="password">New password</label>
    <input id="password" type="password" autoComplete="new-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
    <label htmlFor="confirm">Confirm password</label>
    <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter it" />
    <button className="btn primary" disabled={loading}>{loading ? "Setting up…" : "Set password & sign in"}</button>
    {message && <p className="notice" role="alert">{message}</p>}
  </form>;
}
