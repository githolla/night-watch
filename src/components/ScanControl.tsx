"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "@/lib/run-status";

type RunResponse = { run: RunSummary; stopped: string; error?: string };
type Phase = "idle" | "sweep" | "research" | "stopping";

const STALE_MS = 20 * 3600_000;

/**
 * The scan runs itself. Opening the page starts it when the list has never
 * been scanned, when companies are still unscanned, when a scan was cut off,
 * or when the last one is older than a day; it then continues each run until
 * it closes. The sweep is always the extensive one (roles, AI posts, contacts,
 * every company); the research pass is extensive on the first pass and then
 * covers whoever is past the research cooldown.
 * On Production the scheduled runs do the same without anyone opening a page.
 */
export function ScanControl({ listSize, unscanned, firstPass, openRun, lastFinishedAt }: { listSize: number; unscanned: number; firstPass: boolean; openRun: RunSummary | null; lastFinishedAt: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [run, setRun] = useState<RunSummary | null>(openRun);
  const [spent, setSpent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const active = useRef(false);
  const autoStarted = useRef(false);

  const running = phase !== "idle";
  const resumable = Boolean(openRun && openRun.status === "open");
  const stale = !lastFinishedAt || now - Date.parse(lastFinishedAt) > STALE_MS;
  const shouldAutoStart = listSize > 0 && (firstPass || unscanned > 0 || resumable || stale);

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
    // The rest of the page (scanned count, results) is server-rendered; refresh it now and then while the scan runs.
    const refresh = window.setInterval(() => router.refresh(), 30_000);
    return () => { window.clearInterval(poll); window.clearInterval(refresh); };
  }, [running, run?.id, router]);

  async function post(endpoint: string, body: Record<string, unknown>) {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as RunResponse;
    if (!response.ok) throw new Error(json.error ?? `Request failed (${response.status})`);
    return json;
  }

  /** Create or continue one run and work it until it closes, is stopped, or another window has it. */
  async function driveOne(endpoint: string, start: Record<string, unknown>, carried: Record<string, unknown>, runId?: string) {
    let response = await post(endpoint, runId ? { runId, ...carried } : start);
    setRun(response.run);
    while (active.current && response.run.status === "open" && !["cancelled", "already_closed", "busy"].includes(response.stopped)) {
      response = await post(endpoint, { runId: response.run.id, ...carried });
      setRun(response.run);
    }
    setSpent((total) => total + response.run.costUsd);
    return response;
  }

  /**
   * Everything means everything: keep starting runs until one comes back with
   * nothing to do. Runs left open by an earlier window are finished first,
   * so no company is skipped as "already queued".
   */
  async function drive(endpoint: string, start: Record<string, unknown>, carried: Record<string, unknown>, runId?: string) {
    let response = await driveOne(endpoint, start, carried, runId);
    for (let round = 0; round < 12 && active.current && response.run.status !== "open" && response.stopped !== "cancelled"; round += 1) {
      const next = await driveOne(endpoint, start, carried);
      if (next.run.counts.requested === 0) break;
      response = next;
    }
    return response;
  }

  async function scan() {
    const extensive = firstPass;
    setError(null);
    active.current = true;
    try {
      const resumeSweep = openRun && ["sweep", "sweep_manual"].includes(openRun.source) ? openRun.id : undefined;
      const resumeResearch = openRun && !resumeSweep ? openRun.id : undefined;
      if (!resumeResearch) {
        setPhase("sweep");
        // Every pass is the thorough one for the sweep: careers pages, job boards, AI posts by people at the
        // company, and contacts, for every company, cooldowns ignored. Only the research pass gets cheaper after the first.
        const sweep = await drive("/api/sweep/run", { all: true, populate: true }, { populate: true }, resumeSweep);
        if (!active.current || sweep.stopped === "cancelled" || sweep.stopped === "busy") return;
      }
      setPhase("research");
      await drive("/api/nightly/run", extensive ? { populate: true } : { limit: listSize }, extensive ? { populate: true } : {}, resumeResearch);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The scan failed");
    } finally {
      active.current = false;
      setPhase("idle");
      router.refresh();
    }
  }

  // Start on arrival, once per visit. A page opened while another window is
  // already driving the run stops on the first "busy" answer and just watches.
  useEffect(() => {
    if (autoStarted.current || !shouldAutoStart) return;
    autoStarted.current = true;
    void scan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoStart]);

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
  const lastScan = lastFinishedAt ? new Date(lastFinishedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return <div className="scan-control">
    <div className="scan-actions">
      {running ? <>
        <span className="scan-live"><i />{phase === "sweep" ? "Reading careers pages, job boards and AI posts" : phase === "research" ? "Researching with the model" : "Stopping after the current company"}{total ? ` · ${done} / ${total}` : ""}{counts ? ` · ${counts.ok} with something found` : ""} · ${(spent + (run?.costUsd ?? 0)).toFixed(2)}</span>
        <button className="scan-stop" type="button" disabled={phase === "stopping"} onClick={stop}>Stop</button>
      </> : <>
        <span className="scan-note">{error ? "The scan stopped." : lastScan ? `Up to date. Last scan ${lastScan}. Night Watch keeps scanning on its own; leave this page open or let the nightly run do it.` : "Nothing scanned yet."}</span>
        <button className="scan-stop" type="button" onClick={() => { autoStarted.current = true; void scan(); }}>{error ? "Try again" : "Scan again now"}</button>
      </>}
    </div>
    {running && <div className="run-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ width: `${percent}%` }} /></div>}
    {error && <p className="notice error">{error}</p>}
  </div>;
}
