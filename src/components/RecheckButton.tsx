"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { RunSummary } from "@/lib/run-status";

type RunResponse = { run: RunSummary; stopped: string; error?: string };

/** Re-read this one company now: careers page, job boards, AI posts, contacts, then the research model. */
export function RecheckButton({ accountId, name }: { accountId: string; name: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "sweep" | "research" | "analysis">("idle");
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);

  async function drive(endpoint: string) {
    let response: RunResponse | null = null;
    let body: Record<string, unknown> = { accountIds: [accountId] };
    do {
      const request = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      response = (await request.json().catch(() => ({}))) as RunResponse;
      if (!request.ok) throw new Error(response.error ?? `Request failed (${request.status})`);
      body = { runId: response.run.id };
    } while (active.current && response.run.status === "open" && !["cancelled", "already_closed", "busy"].includes(response.stopped));
  }

  async function recheck() {
    setError(null);
    active.current = true;
    try {
      setPhase("sweep");
      await drive("/api/sweep/run");
      setPhase("research");
      await drive("/api/nightly/run");
      setPhase("analysis");
      await drive("/api/analysis/run");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The check failed");
    } finally {
      active.current = false;
      setPhase("idle");
      router.refresh();
    }
  }

  return <span className="recheck">
    <button type="button" className="scan-stop" disabled={phase !== "idle"} onClick={recheck} title={`Read ${name}'s careers page, job boards and AI posts again, research it, then run the agent swarm: company, hiring, people, voices and a fresh brief`}>
      {phase === "sweep" ? "Reading careers page and posts…" : phase === "research" ? "Researching…" : phase === "analysis" ? "Agent swarm analysing…" : "Analyse again now"}
    </button>
    {error && <span className="notice error">{error}</span>}
  </span>;
}
