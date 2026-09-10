"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) {
      setLoading(false);
      setMessage(result.error ?? "Unable to open the workspace.");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    window.location.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/");
  }

  return <form className="password-form" onSubmit={submit}>
    <label htmlFor="password">Workspace password</label>
    <input id="password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter password" />
    <button className="btn primary" disabled={loading}>{loading ? "Opening…" : "Open Night Watch"}</button>
    {message && <p className="notice" role="alert">{message}</p>}
  </form>;
}
