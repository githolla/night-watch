"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read straight from the form so browser-autofilled values are used even when
    // the autofill never fired an onChange (React state can lag behind the field).
    const data = new FormData(event.currentTarget);
    const emailValue = (String(data.get("email") ?? "") || email).trim();
    const passwordValue = String(data.get("password") ?? "") || password;
    if (!passwordValue) {
      setMessage("Enter your password.");
      return;
    }
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: emailValue, password: passwordValue }),
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
    <label htmlFor="email">Email</label>
    <input id="email" name="email" type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@nine-67.com" />
    <label htmlFor="password">Password</label>
    <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
    <button className="btn primary" disabled={loading}>{loading ? "Signing in…" : "Sign in"}</button>
    {message && <p className="notice" role="alert">{message}</p>}
  </form>;
}
