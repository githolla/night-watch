import type { SupabaseClient } from "@supabase/supabase-js";

export type RunAccountStatus = "queued" | "running" | "ok" | "no_signal" | "error" | "cancelled";
export type RunStatus = "open" | "complete" | "cancelled";

export type RunAccountRow = {
  id: string;
  accountId: string;
  position: number;
  domain: string;
  name: string;
  status: RunAccountStatus;
  errorCode: string | null;
  errorMessage: string | null;
  signalsFound: number;
  signalsKept: number;
  signalsNew: number;
  cardsCreated: number;
  costUsd: number;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

export type RunCounts = {
  requested: number;
  queued: number;
  running: number;
  ok: number;
  noSignal: number;
  error: number;
  cancelled: number;
  /** Rows that reached a terminal state: ok + no_signal + error + cancelled. */
  done: number;
};

export type RunSummary = {
  id: string;
  status: RunStatus;
  source: "scheduled" | "manual";
  startedAt: string;
  finishedAt: string | null;
  heartbeatAt: string | null;
  cancelRequested: boolean;
  invocations: number;
  counts: RunCounts;
  signalsNew: number;
  cardsCreated: number;
  costUsd: number;
  errors: Array<{ account?: string; code?: string; message: string; stage?: string }>;
  rows: RunAccountRow[];
};

type Db = SupabaseClient;

function rowFrom(record: Record<string, unknown>): RunAccountRow {
  return {
    id: String(record.id),
    accountId: String(record.account_id),
    position: Number(record.position ?? 0),
    domain: String(record.domain ?? ""),
    name: String(record.name ?? ""),
    status: (record.status as RunAccountStatus) ?? "queued",
    errorCode: (record.error_code as string | null) ?? null,
    errorMessage: (record.error_message as string | null) ?? null,
    signalsFound: Number(record.signals_found ?? 0),
    signalsKept: Number(record.signals_kept ?? 0),
    signalsNew: Number(record.signals_new ?? 0),
    cardsCreated: Number(record.cards_created ?? 0),
    costUsd: Number(record.cost_usd ?? 0),
    model: (record.model as string | null) ?? null,
    startedAt: (record.started_at as string | null) ?? null,
    finishedAt: (record.finished_at as string | null) ?? null,
    durationMs: record.duration_ms === null || record.duration_ms === undefined ? null : Number(record.duration_ms),
  };
}

export function countRows(rows: RunAccountRow[], requested: number): RunCounts {
  const counts: RunCounts = { requested, queued: 0, running: 0, ok: 0, noSignal: 0, error: 0, cancelled: 0, done: 0 };
  for (const row of rows) {
    if (row.status === "queued") counts.queued += 1;
    else if (row.status === "running") counts.running += 1;
    else if (row.status === "ok") counts.ok += 1;
    else if (row.status === "no_signal") counts.noSignal += 1;
    else if (row.status === "error") counts.error += 1;
    else if (row.status === "cancelled") counts.cancelled += 1;
  }
  counts.done = counts.ok + counts.noSignal + counts.error + counts.cancelled;
  return counts;
}

export async function loadRunSummary(db: Db, runId: string): Promise<RunSummary | null> {
  const [{ data: run, error }, { data: rowRecords, error: rowsError }] = await Promise.all([
    db.from("runs").select("*").eq("id", runId).maybeSingle(),
    db.from("run_accounts").select("*").eq("run_id", runId).order("position"),
  ]);
  if (error) throw error;
  if (rowsError) throw rowsError;
  if (!run) return null;
  const rows = (rowRecords ?? []).map((record) => rowFrom(record as Record<string, unknown>));
  const requested = Number(run.requested_accounts ?? rows.length);
  return {
    id: run.id,
    status: (run.status as RunStatus) ?? (run.finished_at ? "complete" : "open"),
    source: run.source === "manual" ? "manual" : "scheduled",
    startedAt: run.started_at,
    finishedAt: run.finished_at ?? null,
    heartbeatAt: run.heartbeat_at ?? null,
    cancelRequested: Boolean(run.cancel_requested),
    invocations: Number(run.invocations ?? 0),
    counts: countRows(rows, requested),
    signalsNew: Number(run.signals_new ?? 0),
    cardsCreated: Number(run.cards_created ?? 0),
    costUsd: Number(run.cost_usd ?? 0),
    errors: Array.isArray(run.errors) ? (run.errors as RunSummary["errors"]) : [],
    rows,
  };
}

/** The newest run of any source, for the desk. */
export async function latestRunSummary(db: Db) {
  const { data } = await db.from("runs").select("id").order("started_at", { ascending: false }).limit(1).maybeSingle();
  return data ? loadRunSummary(db, data.id) : null;
}

/** Plain-language outcome of a run for the desk headline. */
export type RunOutcome = "none" | "in_progress" | "empty" | "failed" | "partial" | "quiet" | "found" | "cancelled";

export function runOutcome(run: RunSummary | null): RunOutcome {
  if (!run) return "none";
  if (run.status === "open") return "in_progress";
  const attempted = run.counts.ok + run.counts.noSignal + run.counts.error;
  if (attempted === 0) return run.counts.cancelled > 0 ? "cancelled" : "empty";
  if (run.counts.error === attempted) return "failed";
  if (run.counts.error > 0) return "partial";
  if (run.counts.ok > 0 || run.cardsCreated > 0) return "found";
  return "quiet";
}
