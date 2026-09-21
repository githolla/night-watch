"use client";

import { useEffect, useState } from "react";
import { PanelGuide } from "./PanelGuide";

const GREETING_KEY = "nw.blanketGreeting";

// Admin draft tools: rewrite every un-sent email through the founder-voice rewriter, or set one blanket
// greeting across all of them.
export function RewriteDrafts() {
  const [running, setRunning] = useState<"" | "rewrite" | "greeting" | "clean">("");
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

  // Repair drafts already saved with a repeated opener / stray link / the old "teardown" CTA. Deterministic
  // and free — no model calls — unlike "Rewrite all drafts".
  async function cleanUp() {
    if (running) return;
    if (!confirm("Clean up every un-sent draft? Removes repeated lines, links in the body, and the old “teardown” line. No AI, nothing is rewritten.")) return;
    setRunning("clean"); setMsg("Cleaning drafts…");
    try {
      let offset = 0, fixed = 0, blanked = 0;
      for (let i = 0; i < 60; i++) {
        const res = await fetch("/api/admin/clean-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Clean-up failed."); return; }
        fixed += json.cleaned ?? 0; blanked += json.skipped ?? 0; offset = json.offset ?? offset;
        setMsg(`Checked ${offset} draft${offset === 1 ? "" : "s"}, fixed ${fixed}…`);
        if (json.done) break;
      }
      setMsg(`Done — checked ${offset} drafts and fixed ${fixed}. Drafts that were already clean were left untouched${blanked ? `; ${blanked} skipped to avoid emptying them` : ""}. Reload the desk to see them.`);
    } catch { setMsg("Clean-up failed — try again."); }
    finally { setRunning(""); }
  }

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
      <div className="conn-head"><h2>Change every email at once</h2></div>
      <PanelGuide
        what="Applies one change to every email still waiting to be sent, instead of you opening them one at a time."
        when={<>You&rsquo;ve noticed the same problem in several drafts &mdash; a repeated line, the wrong greeting, a phrase you don&rsquo;t want going out &mdash; and fixing them individually would take all afternoon.</>}
        watch={<>Nothing here touches an email you&rsquo;ve already sent, and every draft stays editable afterwards. Only <strong>Rewrite all drafts</strong> costs money; the other two are instant and free.</>}
      />

      <h3 className="panel-subhead">Rewrite all drafts <span className="panel-cost is-paid">Costs money</span></h3>
      <p className="conn-note">Hands every un-sent email back to the writing model to be written again from scratch, following the current rules: plain language, specific to that company, no vendor buzzwords, no em dashes. Use it when the drafts read generically. It replaces what is there, so anything you edited by hand is lost &mdash; and because it calls the model once per draft, it takes a few minutes and adds to your API bill.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={rewrite} disabled={!!running}>{running === "rewrite" ? "Rewriting…" : "Rewrite all drafts"}</button>
        <button type="button" className="btn primary" onClick={cleanUp} disabled={!!running} title="Removes repeated lines, links in the body, and the old “teardown” CTA from drafts already saved. No AI, no cost.">{running === "clean" ? "Cleaning…" : "Clean up all drafts"}</button>
      </div>
      <p className="conn-note" style={{ marginTop: 8 }}><strong>Clean up all drafts</strong> is the safe one. It removes an opening line that got saved twice, a stray link in the body, and the old &ldquo;teardown&rdquo; sentence &mdash; and nothing else. It doesn&rsquo;t reword a single sentence, doesn&rsquo;t call the model, costs nothing, and leaves a draft alone if there is nothing to fix. Start here before reaching for a rewrite.</p>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
        <h3 className="panel-subhead">One greeting everywhere <span className="panel-cost is-free">Free</span></h3>
        <p className="conn-note">Replaces the opening line of every un-sent email with the one you type here. Write <code>{"{first}"}</code> where the contact&rsquo;s first name should go, so <em>Hi {"{first}"},</em> reaches Robert as <em>Hi Robert,</em>. Use it when you want a consistent opener across the whole list. It swaps the greeting only &mdash; the rest of each email is untouched.</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Hi {first}," style={{ flex: "1 1 260px", minWidth: 0, border: "1px solid var(--line-strong)", borderRadius: "var(--radius-sm)", background: "var(--paper-bright)", padding: "9px 11px", font: "500 14px/1 var(--sans)", color: "inherit" }} />
          <button type="button" className="btn" onClick={applyGreeting} disabled={!!running}>{running === "greeting" ? "Applying…" : "Apply to all emails"}</button>
        </div>
      </div>

      {msg && <p className="notice" role="status" style={{ marginTop: 12 }}>{msg}</p>}
    </section>
  );
}
