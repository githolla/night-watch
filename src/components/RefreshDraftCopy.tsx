"use client";
import { useEffect, useState } from "react";
const VERSION = "nw.proof-copy-20260922-v1";

/** Update saved drafts after the desk is usable; never make rendering wait for writes. */
export function RefreshDraftCopy() {
  const [message, setMessage] = useState("");
  const [hasUpdates, setHasUpdates] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function update() {
      try { if (sessionStorage.getItem(VERSION) === "done") return; } catch { /* storage optional */ }
      let changed = 0;
      setMessage("Updating untouched drafts with relevant Nine-67 proof. You can keep using the worklist.");
      try {
        for (let pass = 0; pass < 15 && !cancelled; pass++) {
          const response = await fetch("/api/desk/repair-drafts", { method: "POST" });
          const result = await response.json();
          if (!response.ok || result.failed) throw new Error(result.error || "Some drafts could not be updated. Reload to retry.");
          changed += result.repaired ?? 0;
          if (result.done) {
            if (cancelled) return;
            try { sessionStorage.setItem(VERSION, "done"); } catch { /* storage optional */ }
            setMessage(changed ? `Updated ${changed} drafts. Sent emails and valid hand-edited drafts were preserved.` : "Draft copy is up to date; valid hand-edited drafts were preserved.");
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
