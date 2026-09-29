"use client";
import { useEffect, useState } from "react";


/** Update saved drafts after the desk is usable; never make rendering wait for writes. */
export function RefreshDraftCopy({ revision }: { revision: string }) {
  const [message, setMessage] = useState("");
  const [hasUpdates, setHasUpdates] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const version = `nw.reviewed-copy.${revision}`;
    async function update() {
      try { if (sessionStorage.getItem(version) === "done") return; } catch { /* storage optional */ }
      let changed = 0;
      let cursor: string | undefined;
      setMessage("Checking for draft updates…");
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
            try { sessionStorage.setItem(version, "done"); } catch { /* storage optional */ }
            setMessage(changed ? `${changed} drafts updated. Your edits were kept.` : "");
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
  }, [revision]);
  return message ? <div className="draft-refresh-status" role="status">{message} {hasUpdates && <button type="button" onClick={() => window.location.reload()}>Load updated drafts</button>} <button type="button" className="status-dismiss" aria-label="Dismiss draft update" onClick={() => setMessage("")}>×</button></div> : null;
}
