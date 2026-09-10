"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunAccountRow, RunSummary } from "@/lib/run-status";

type RunResponse = { run: RunSummary; stopped: string; error?: string; code?: string };

const STATUS_LABEL: Record<RunAccountRow["status"], string> = {
  queued: "Queued",
  running: "Researching",
  ok: "Signal found",
  no_signal: "No signal",
  error: "Failed",
  cancelled: "Stopped",
};

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function firstLine(message: string) {
  return message.split(/\r?\n/)[0].slice(0, 160);
}

export function RunPanel({
  initialRun,
  batchSize,
  projectedMaxCostUsd,
  disabled = false,
  showHistory = true,
  endpoint = "/api/nightly/run",
  kind = "research",
  extraActions,
}: {
  initialRun: RunSummary | null;
  batchSize: number;
  projectedMaxCostUsd: number;
  disabled?: boolean;
  /** Show the last run's log even when nothing is running. */
  showHistory?: boolean;
  /** POST target that creates or continues the run. */
  endpoint?: string;
  /** Research reads the public web with a model; a sweep reads careers pages with no model. */
  kind?: "research" | "sweep";
  /** Extra ways to start a run, such as an initial populate pass. */
  extraActions?: Array<{ label: string; body: Record<string, unknown>; confirm?: string }>;
}) {
  const router = useRouter();
  const [run, setRun] = useState<RunSummary | null>(initialRun);
  const [phase, setPhase] = useState<"idle" | "running" | "stopping">("idle");
  const [error, setError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const active = useRef(false);
  /** Flags that must travel with every continuation call for the run in progress. */
  const carried = useRef<Record<string, unknown>>({});

  const running = phase !== "idle";
  const runOpen = run?.status === "open";

  // Live rows come from run_accounts, never from client-side counters.
  useEffect(() => {
    if (!running || !run?.id) return;
    const id = run.id;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/nightly/run/${id}`, { cache: "no-store" });
        if (!response.ok) return;
        const json = (await response.json()) as { run: RunSummary };
        setRun(json.run);
      } catch {
        // A missed poll is harmless; the next one catches up.
      }
    }, 2000);
    const tick = window.setInterval(() => setClock(Date.now()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [running, run?.id]);

  async function post(body: Record<string, unknown>): Promise<RunResponse> {
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await response.json().catch(() => ({}))) as RunResponse;
    if (!response.ok) throw new Error(json.error ?? `Research request failed (${response.status})`);
    return json;
  }

  /** One POST creates the run; later POSTs continue it until the run closes. */
  async function drive(body: Record<string, unknown>) {
    setPhase("running");
    setError(null);
    active.current = true;
    try {
      carried.current = body.populate ? { populate: true } : {};
      let response = await post(body);
      setRun(response.run);
      while (active.current && response.run.status === "open" && !["cancelled", "already_closed", "busy"].includes(response.stopped)) {
        response = await post({ runId: response.run.id, ...carried.current });
        setRun(response.run);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Research failed");
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
      const response = await fetch(`/api/nightly/run/${run.id}/cancel`, { method: "POST" });
      const json = (await response.json()) as { run?: RunSummary; error?: string };
      if (json.run) setRun(json.run);
      if (!response.ok) setError(json.error ?? "Unable to stop the run");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to stop the run");
    } finally {
      setPhase("idle");
      router.refresh();
    }
  }

  const failedIds = run?.rows.filter((row) => row.status === "error").map((row) => row.accountId) ?? [];
  const allIds = run?.rows.map((row) => row.accountId) ?? [];
  const started = run ? Date.parse(run.startedAt) : 0;
  const ended = run?.finishedAt ? Date.parse(run.finishedAt) : clock;
  const elapsed = run ? formatDuration(Math.max(0, ended - started)) : null;
  const counts = run?.counts;
  const total = counts?.requested ?? 0;
  const done = counts?.done ?? 0;
  const remaining = Math.max(0, total - done);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const showLog = run && (running || runOpen || showHistory) && run.rows.length > 0;

  return (
    <section className="run-panel" id="run-log" aria-live="polite">
      <div className="run-panel-actions">
        {runOpen && !running ? (
          <button className="btn primary" type="button" disabled={disabled} onClick={() => drive({ runId: run.id })}>
            Continue this run · {remaining} to go
          </button>
        ) : (
          <button className="btn primary" type="button" disabled={disabled || running} onClick={() => drive({ limit: batchSize })}>
            {running ? (kind === "sweep" ? "Sweep in progress…" : "Research in progress…") : kind === "sweep" ? `Sweep the next ${batchSize} careers pages` : `Research the next ${batchSize} companies`}
          </button>
        )}
        {(running || runOpen) && (
          <button className="btn danger" type="button" disabled={phase === "stopping" || run?.cancelRequested} onClick={stop}>
            {phase === "stopping" || run?.cancelRequested ? "Stopping after this company…" : "Stop"}
          </button>
        )}
        {!running && failedIds.length > 0 && (
          <button className="btn" type="button" disabled={disabled} onClick={() => drive({ accountIds: failedIds })}>
            Retry the {failedIds.length} that failed
          </button>
        )}
        {!running && !runOpen && extraActions?.map((action) => (
          <button key={action.label} className="btn" type="button" disabled={disabled} onClick={() => { if (!action.confirm || window.confirm(action.confirm)) void drive(action.body); }}>
            {action.label}
          </button>
        ))}
        {!running && !runOpen && allIds.length > 0 && (
          <button className="btn" type="button" disabled={disabled} title="Ignores the research cooldown so the same companies are checked again under the current rules" onClick={() => drive({ accountIds: allIds })}>
            Research these {allIds.length} again
          </button>
        )}
        {!running && !runOpen && <span className="run-panel-estimate">{kind === "sweep" ? "No model calls until a hiring signal is found; outreach drafting is the only cost" : `≈ $${projectedMaxCostUsd.toFixed(2)} maximum for ${batchSize} companies`}</span>}
      </div>

      {error && <p className="notice error">{error}</p>}

      {run && (running || runOpen || showHistory) && (
        <div className="run-panel-status">
          <div className="run-panel-line">
            <strong>
              {runOpen ? "Checking" : run.status === "cancelled" ? "Stopped after" : "Checked"} {total} {total === 1 ? "company" : "companies"}
            </strong>
            <span>{done} done</span>
            {runOpen && <span>{remaining} to go</span>}
            {counts && counts.ok > 0 && <span className="is-ok">{counts.ok} with a signal</span>}
            {counts && counts.error > 0 && <span className="is-failed">{counts.error} failed</span>}
            {elapsed && <span>{elapsed} elapsed</span>}
            <span>${run.costUsd.toFixed(2)}</span>
            {run.invocations > 1 && <span>{run.invocations} windows</span>}
          </div>
          <div className="run-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      {showLog && <RunLog rows={run.rows} kind={kind} onRetry={running || disabled ? undefined : (accountId) => drive({ accountIds: [accountId] })} />}
    </section>
  );
}

export function RunLog({ rows, onRetry, kind = "research" }: { rows: RunAccountRow[]; onRetry?: (accountId: string) => void; kind?: "research" | "sweep" }) {
  return (
    <div className="run-log-wrap">
      <table className="run-log">
        <thead>
          <tr>
            <th>#</th>
            <th>Company</th>
            <th>Status</th>
            <th>Time</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={`is-${row.status}`}>
              <td className="run-log-index">{String(row.position).padStart(2, "0")}</td>
              <td>
                <strong>{row.name}</strong>
                <small>{row.domain}</small>
              </td>
              <td>
                <span className={`status-chip ${row.status}`}>{STATUS_LABEL[row.status]}</span>
              </td>
              <td className="run-log-time">{row.durationMs !== null ? formatDuration(row.durationMs) : row.status === "running" ? "…" : "—"}</td>
              <td className="run-log-outcome">
                {row.status === "error" ? (
                  <details>
                    <summary>
                      <code>{row.errorCode ?? "unknown"}</code> {firstLine(row.errorMessage ?? "Research failed")}
                    </summary>
                    <pre>{row.errorMessage}</pre>
                    {onRetry && (
                      <button type="button" className="run-log-retry" onClick={() => onRetry(row.accountId)}>
                        Retry {row.name}
                      </button>
                    )}
                  </details>
                ) : row.status === "ok" ? (
                  <span>
                    {kind === "sweep" ? (row.note ?? `${row.signalsKept} target roles open`) : `${row.signalsKept} signal${row.signalsKept === 1 ? "" : "s"} saved`}
                    {row.cardsCreated > 0 ? ` · ${row.cardsCreated} dossier${row.cardsCreated === 1 ? "" : "s"} drafted` : ""}
                    {kind !== "sweep" && row.signalsNew === 0 && row.signalsKept > 0 ? " · already on file" : ""}
                  </span>
                ) : row.status === "no_signal" ? (
                  <span>
                    {kind === "sweep"
                      ? (row.note ?? (row.signalsFound > 0 ? `${row.signalsFound} postings, none in a target family` : "No postings readable"))
                      : row.signalsFound > 0 ? `${row.signalsFound} found, none qualified (confidence floor or evidence rules)` : "No hiring, request for help, or operating mandate found in 180 days"}
                  </span>
                ) : row.status === "running" ? (
                  <span>{kind === "sweep" ? "Reading the careers page…" : "Searching the public web…"}</span>
                ) : (
                  <span>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
