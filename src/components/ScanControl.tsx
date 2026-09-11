"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "@/lib/run-status";

type RunResponse = { run: RunSummary; stopped: string; error?: string };
type Phase = "idle" | "sweep" | "research" | "stopping";

/**
 * One button that scans the reach-out list end to end: the careers sweep
 * first (roles, AI posts, contacts), then the research pass (managers asking
 * for help, mandates, growth events), continuing each run until it closes.
 * The first press is the extensive pass; later presses are updates.
 */
export function ScanControl({ listSize, firstPass, openRun, disabled }: { listSize: number; firstPass: boolean; openRun: RunSummary | null; disabled?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<RunSummary | null>(openRun);
  const [spent, setSpent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);

  const running = phase !== "idle";

  useEffect(() => {
    if (!running || !run?.id) return;
    const id = run.id;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/nightly/run/${id}`, { cache: "no-store" });
        if (response.ok) setRun(((await response.json()) as { run: RunSummary }).run);
      } catch {
        // The next poll catches up.
      }
    }, 2500);
    return () => window.clearInterval(poll);
  }, [running, run?.id]);

  async function post(endpoint: string, body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as RunResponse;
    if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
    return json;
  }

  /** Create or continue one run and work it until it closes or is stopped. */
  async function drive(endpoint: string, start: Record<string, unknown>, carried: Record<string, unknown>, runId?: string) {
    let response = await post(endpoint, runId ? { runId, ...carried } : start);
    setRun(response.run);
    let cost = response.run.costUsd;
    while (active.current && response.run.status === "open" && !["cancelled", "already_closed", "busy"].includes(response.stopped)) {
      response = await post(endpoint, { runId: response.run.id, ...carried });
      setRun(response.run);
      cost = response.run.costUsd;
    }
    setSpent((total) => total + cost);
    return response;
  }

  async function scan() {
    const extensive = firstPass;
    if (extensive && !window.confirm(`Scan all ${listSize} reach-out companies. This first pass is the thorough one: careers pages, job boards, AI posts, contacts, then the research model on every company. It runs until it is done or you press Stop, and it spends real money while it runs.`)) return;
    setError(null);
    active.current = true;
    try {
      const resumeSweep = openRun && ["sweep", "sweep_manual"].includes(openRun.source) ? openRun.id : undefined;
      const resumeResearch = openRun && !resumeSweep ? openRun.id : undefined;
      if (!resumeResearch) {
        setPhase("sweep");
        const sweep = await drive("/api/sweep/run", extensive ? { all: true, populate: true } : { limit: listSize }, extensive ? { populate: true } : {}, resumeSweep);
        if (!active.current || sweep.stopped === "cancelled") return;
      }
      setPhase("research");
      await drive("/api/nightly/run", extensive ? { populate: true } : { limit: Math.min(listSize, 100) }, extensive ? { populate: true } : {}, resumeResearch);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scan failed");
    } finally {
      active.current = false;
      setPhase("idle");
      router.refresh();
    }
  }

  async function stop() {
    if (!run) return;
    setPhase("stopping");
    active.current = false;
    try {
      await fetch(`/api/nightly/run/${run.id}/cancel`, { method: "POST" });
    } finally {
      setPhase("idle");
      router.refresh();
    }
  }

  const counts = run?.counts;
  const total = counts?.requested ?? 0;
  const done = counts?.done ?? 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const resumable = !running && openRun && openRun.status === "open";

  return <div className="scan-control">
    <div className="scan-actions">
      {running
        ? <button className="btn danger" type="button" disabled={phase === "stopping"} onClick={stop}>{phase === "stopping" ? "Stopping…" : "Stop"}</button>
        : <button className="btn primary scan-button" type="button" disabled={disabled} onClick={scan}>{resumable ? "Continue the scan" : firstPass ? `Scan all ${listSize} companies` : "Scan for updates"}</button>}
      <span className="scan-note">
        {running
          ? phase === "sweep" ? `Reading careers pages, job boards and AI posts… ${done} / ${total}` : phase === "research" ? `Researching with the model… ${done} / ${total}` : "Stopping after the current company…"
          : resumable ? `A scan was interrupted with ${Math.max(0, openRun.counts.requested - openRun.counts.done)} companies left.` : firstPass ? "First pass: everything, for every company. Runs until done; you can stop it any time and continue later." : "Checks every company for new roles, posts and people, then researches the ones that changed. The scheduled runs do this on their own every night."}
      </span>
    </div>
    {running && <div className="run-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
    {running && counts && <div className="run-panel-line"><span className="is-ok">{counts.ok} with something found</span>{counts.error > 0 && <span className="is-failed">{counts.error} failed</span>}<span>${(spent + (run?.costUsd ?? 0)).toFixed(2)} spent</span></div>}
    {error && <p className="notice error">{error}</p>}
  </div>;
}
