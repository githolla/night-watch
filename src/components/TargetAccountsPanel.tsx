"use client";

import { useState } from "react";

export function TargetAccountsPanel({ initialCount, targetTotal }: { initialCount: number; targetTotal: number }) {
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
    setMessage(`${result.total} companies are active; ${result.outreach} are on the reach-out list (Tier A) and ${result.removed} the cut removed are paused.`);
    window.setTimeout(() => window.location.reload(), 1400);
  }

  return <section className="panel target-control">
    <div>
      <span className="eyebrow">Target universe</span>
      <h2>{targetTotal.toLocaleString()} qualified companies</h2>
      <p>Your complete $50M+ target list, with the reach-out cut applied: Tier A is contacted, Tiers B and C are held and watched, and removed companies are paused. Syncing writes the tiers to the database; a company put on or taken off the list by hand keeps that decision.</p>
    </div>
    <div className="target-control-status">
      <span>ACTIVE ACCOUNTS</span>
      <strong>{count}</strong>
      <small>{count === targetTotal ? "READY FOR NIGHT WATCH" : "SYNC REQUIRED"}</small>
    </div>
    <button className="btn primary" type="button" onClick={syncTargets} disabled={state === "loading"}>
      {state === "loading" ? "Syncing…" : count === targetTotal ? "Refresh target list" : `Load ${targetTotal.toLocaleString()} companies`}
    </button>
    {message && <p className={state === "error" ? "notice" : "target-success"}>{message}</p>}
    <span className="target-source">SOURCE · NINE67 OUTBOUND TARGETS $50M+</span>
  </section>;
}
