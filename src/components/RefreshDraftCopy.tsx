"use client";
import { useEffect, useState } from "react";
const VERSION = "nw.recipient-research-20260923-cold-v3";

/** Update saved drafts after the desk is usable; never make rendering wait for writes. */
export function RefreshDraftCopy() {
  const [message, setMessage] = useState("");
  const [hasUpdates, setHasUpdates] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function update() {
      try { if (sessionStorage.getItem(VERSION) === "done") return; } catch { /* storage optional */ }
      let changed = 0;
      let cursor: string | undefined;
      setMessage("Checking untouched drafts for newer copy. Research coverage is shown beside each email.");
      try {
        for (let pass = 0; pass < 30 && !cancelled; pass++) {
          const response = await fetch("/api/desk/repair-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor }) });
          const result = await response.json();
          if (!response.ok || result.failed) throw new Error(result.error || "Some drafts could not be updated. Reload to retry.");
          changed += result.repaired ?? 0;
          cursor = result.nextCursor;
          if (!cancelled && result.updates?.length) window.dispatchEvent(new CustomEvent("night-watch:draft-updates", { detail: result.updates }));
          if (result.done) {
            if (cancelled) return;
            try { sessionStorage.setItem(VERSION, "done"); } catch { /* storage optional */ }
            setMessage(changed ? `Updated ${changed} drafts; unchanged previews refreshed automatically. Sent, edited and approved drafts were preserved. Check the research note beside each email.` : "Refresh complete; no untouched drafts changed. This does not confirm buyer fit or person-specific research. Edited and approved drafts were preserved.");
            if (changed) setHasUpdates(true);
            return;
          }
        }
        if (!cancelled) setMessage("Draft updates are partly complete. Reload to continue.");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not update drafts.");
      }
    }
    void update();
    return () => { cancelled = true; };
  }, []);
  return message ? <p className="notice" role="status">{message} {hasUpdates && <button type="button" onClick={() => window.location.reload()}>Load updated drafts</button>}</p> : null;
}
