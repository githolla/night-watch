"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { considered: number; created: number; skipped: number; error?: string };

/** One press drafts a reach-out for every hiring company from what is already on file. Repeatable; it continues where it stopped. */
export function BackfillDraftsButton() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "running">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    setError(null);
    setMessage(null);
    let created = 0;
    try {
      // Each press works within a time budget and skips companies that already have a draft, so loop until nothing new is created.
      for (let round = 0; round < 12; round += 1) {
        const response = await fetch("/api/drafts/backfill", { method: "POST" });
        const json = (await response.json().catch(() => ({}))) as Result;
        if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
        created += json.created;
        setMessage(`${created} reach-outs drafted so far…`);
        if (json.created === 0) break;
      }
      setMessage(`${created} reach-outs drafted. Open the Desk to work them.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The draft pass failed");
    } finally {
      setPhase("idle");
    }
  }

  return <div className="run-panel-actions">
    <button className="btn primary" type="button" disabled={phase === "running"} onClick={run}>
      {phase === "running" ? "Drafting reach-outs…" : "Draft a reach-out for every hiring company now"}
    </button>
    <span className="run-panel-estimate">Uses the roles and people already on file; no re-scrape. One drafting call per company.</span>
    {message && <span className="outreach-form-saved">{message}</span>}
    {error && <p className="notice error">{error}</p>}
  </div>;
}
