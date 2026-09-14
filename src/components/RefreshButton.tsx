"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Runs the recompute now — re-scores the open cards and clears anything off-list, stale, or below the bar. */
export function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch("/api/desk/refresh", { method: "POST" });
      router.refresh();
    } catch {
      /* a failed refresh just leaves the desk as it was */
    } finally {
      setBusy(false);
    }
  }

  return <button type="button" className="btn" disabled={busy} onClick={run}>{busy ? "Refreshing…" : "Refresh"}</button>;
}
