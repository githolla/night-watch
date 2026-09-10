"use client";

import { useState } from "react";

type Result = {
  accounts: number;
  signals: number;
  cards: number;
  errors: unknown[];
};

export function RunNightWatchButton({ disabled = false }: { disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function run() {
    setState("running");
    setMessage("Researching 10 companies. This can take a few minutes; keep this page open.");
    const response = await fetch("/api/nightly/run", { method: "POST" });
    const result = await response.json() as Result & { error?: string };
    if (!response.ok) {
      setState("error");
      setMessage(result.error ?? "The research run failed.");
      return;
    }
    setState("done");
    setMessage(`Scanned ${result.accounts} companies, found ${result.signals} signals, and created ${result.cards} desk cards. ${result.errors.length} companies returned errors.`);
    window.setTimeout(() => window.location.reload(), 1800);
  }

  return <div className="run-watch-control">
    <button className="btn primary" type="button" disabled={disabled || state === "running"} onClick={run}>
      {state === "running" ? "Research running…" : "Run a 10-company scan"}
    </button>
    {message && <p className={state === "error" ? "notice error" : "notice"} aria-live="polite">{message}</p>}
  </div>;
}
