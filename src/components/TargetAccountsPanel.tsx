"use client";

import { useState } from "react";

export function TargetAccountsPanel({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function syncTargets() {
    setState("loading");
    setMessage("");
    const response = await fetch("/api/accounts/targets", { method: "POST" });
    const result = await response.json();
    if (!response.ok) {
      setState("error");
      setMessage(result.error ?? "Unable to sync target accounts.");
      return;
    }
    setCount(result.total);
    setState("success");
    setMessage(`${result.total} target companies are active and ready for nightly research.`);
  }

  return <section className="panel target-control">
    <div>
      <span className="eyebrow">Target universe</span>
      <h2>100 qualified companies</h2>
      <p>U.S. upper-mid-market companies with reported annual revenue between $3.19B and $4.81B. Built for operations, data, automation, and customer-workflow signals.</p>
    </div>
    <div className="target-control-status">
      <span>ACTIVE ACCOUNTS</span>
      <strong>{count}</strong>
      <small>{count === 100 ? "READY FOR NIGHT WATCH" : "SYNC REQUIRED"}</small>
    </div>
    <button className="btn primary" type="button" onClick={syncTargets} disabled={state === "loading"}>
      {state === "loading" ? "Syncing…" : count === 100 ? "Refresh target list" : "Load 100 companies"}
    </button>
    {message && <p className={state === "error" ? "notice" : "target-success"}>{message}</p>}
    <a href="https://us500.com/fortune-1000-companies" target="_blank" rel="noreferrer">Review qualification source ↗</a>
  </section>;
}
