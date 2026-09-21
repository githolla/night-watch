"use client";

import { useState } from "react";

// Admin one-click: rewrite every un-sent email draft through the current founder-voice rewriter, in
// batches, so the whole worklist picks up the new drafting quality at once.
export function RewriteDrafts() {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [msg, setMsg] = useState("");

  async function run() {
    if (running) return;
    if (!confirm("Rewrite every un-sent email draft with the latest founder-voice rules? This updates the drafts in place (you can still edit any before sending).")) return;
    setRunning(true); setDone(0); setMsg("Rewriting drafts…");
    const before = new Date().toISOString();
    let total = 0;
    try {
      for (let i = 0; i < 40; i++) { // safety cap; each pass does 25
        const res = await fetch("/api/admin/rewrite-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ before }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Rewrite failed."); break; }
        total += json.rewritten ?? 0; setDone(total);
        setMsg(`Rewritten ${total} so far${json.remaining ? ` · ${json.remaining} to go…` : ""}`);
        if (!json.remaining) { setMsg(`Done — rewrote ${total} draft${total === 1 ? "" : "s"}. Reload the desk to see them.`); break; }
      }
    } catch { setMsg("Rewrite failed — try again."); }
    finally { setRunning(false); }
  }

  return (
    <section className="conn-card">
      <div className="conn-head"><h2>Draft quality</h2></div>
      <p className="conn-note">Rewrite every un-sent email in the worklist with the latest founder-voice rules (plain, specific, no vendor buzzwords). Runs on the writing model; each draft stays editable before you send.</p>
      <button type="button" className="btn" onClick={run} disabled={running}>{running ? "Rewriting…" : "Rewrite all drafts"}</button>
      {msg && <p className="notice" role="status" style={{ marginTop: 10 }}>{msg}{running && done > 0 ? "" : ""}</p>}
    </section>
  );
}
