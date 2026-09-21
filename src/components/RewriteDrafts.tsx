"use client";

import { useEffect, useState } from "react";

const GREETING_KEY = "nw.blanketGreeting";

// Admin draft tools: rewrite every un-sent email through the founder-voice rewriter, or set one blanket
// greeting across all of them.
export function RewriteDrafts() {
  const [running, setRunning] = useState<"" | "rewrite" | "greeting">("");
  const [msg, setMsg] = useState("");
  const [greeting, setGreeting] = useState("Hi {first},");

  // The greeting field resets to the default on every reload, which reads as "my greeting didn't save."
  // Persist the last value locally so the panel reopens showing what the admin actually set.
  useEffect(() => {
    // localStorage is an external store only available on the client; hydrating from it must run in a
    // mount effect (not render/lazy-init) to avoid an SSR hydration mismatch on the input value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = localStorage.getItem(GREETING_KEY); if (saved) setGreeting(saved); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(GREETING_KEY, greeting); } catch { /* ignore */ }
  }, [greeting]);

  async function drain(url: string, extra: Record<string, unknown>, label: string, key: "rewritten" | "applied") {
    const before = new Date().toISOString();
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...extra, before }) });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Something went wrong."); return; }
      total += json[key] ?? 0;
      setMsg(`${label} ${total} so far${json.remaining ? ` · ${json.remaining} to go…` : ""}`);
      if (!json.remaining) { setMsg(`Done — ${label.toLowerCase()} ${total} draft${total === 1 ? "" : "s"}. Reload the desk to see them.`); return; }
    }
  }

  async function rewrite() {
    if (running) return;
    if (!confirm("Rewrite every un-sent email draft with the latest founder-voice rules? Each stays editable before you send.")) return;
    setRunning("rewrite"); setMsg("Rewriting drafts…");
    try { await drain("/api/admin/rewrite-drafts", {}, "Rewrote", "rewritten"); } catch { setMsg("Rewrite failed — try again."); }
    finally { setRunning(""); }
  }

  async function applyGreeting() {
    if (running) return;
    if (!greeting.trim()) { setMsg("Type a greeting first."); return; }
    if (!confirm(`Set the greeting on every un-sent email to “${greeting.trim()}” (with {first} replaced by each contact's first name)?`)) return;
    setRunning("greeting"); setMsg("Applying greeting…");
    try { await drain("/api/admin/apply-greeting", { greeting }, "Updated", "applied"); } catch { setMsg("Update failed — try again."); }
    finally { setRunning(""); }
  }

  return (
    <section className="conn-card">
      <div className="conn-head"><h2>Draft quality</h2></div>

      <p className="conn-note">Rewrite every un-sent email in the worklist with the latest founder-voice rules (plain, specific, no vendor buzzwords, no em dashes, real link only). Runs on the writing model; each draft stays editable before you send.</p>
      <button type="button" className="btn" onClick={rewrite} disabled={!!running}>{running === "rewrite" ? "Rewriting…" : "Rewrite all drafts"}</button>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <p className="conn-note">Set one greeting across every un-sent email. Use <code>{"{first}"}</code> for the contact&apos;s first name.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Hi {first}," style={{ flex: "1 1 260px", minWidth: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
          <button type="button" className="btn" onClick={applyGreeting} disabled={!!running}>{running === "greeting" ? "Applying…" : "Apply to all emails"}</button>
        </div>
      </div>

      {msg && <p className="notice" role="status" style={{ marginTop: 12 }}>{msg}</p>}
    </section>
  );
}
