"use client";

import { useEffect, useState } from "react";
import { PanelGuide } from "./PanelGuide";

type Issue = { number: number; title: string; state: string; url: string; created_at: string; closed_at: string | null; comments: number; lastComment: string | null };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Admin view of the feedback → auto-fix loop: run the digest on demand, and see what the agent fixed. */
export function FeedbackAutomation() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/admin/feedback-issues", { cache: "no-store" });
      const json = await res.json();
      if (json.error === "not-configured") setConfigured(false);
      setIssues(json.issues ?? []);
    } catch { /* leave empty */ }
    finally { setLoading(false); }
  }
  useEffect(() => {
    let live = true;
    fetch("/api/admin/feedback-issues", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { issues: [] }))
      .then((json) => { if (!live) return; if (json.error === "not-configured") setConfigured(false); setIssues(json.issues ?? []); setLoading(false); })
      .catch(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);

  async function runNow() {
    setRunning(true); setMessage("");
    try {
      const res = await fetch("/api/admin/feedback-digest", { method: "POST" });
      const json = await res.json();
      if (!res.ok || json.error) { setMessage(json.error ?? "Could not run the digest."); return; }
      setMessage(json.posted ? `Posted a digest of ${json.count} new item${json.count === 1 ? "" : "s"} — the fix agent picks it up at its next run (or on the schedule).` : (json.reason ?? "Nothing new to send."));
      await load();
    } catch { setMessage("Could not run the digest."); }
    finally { setRunning(false); }
  }

  const openCount = issues.filter((issue) => issue.state !== "closed").length;
  return (
    <section className="conn-card">
      <PanelGuide
        what={<>Collects the feedback testers send from inside the app and posts it to GitHub each night as a single list, so the coding agent can pick the fixes up.</>}
        when={<>Leave it running. Open it when you want to see what testers have reported lately and whether anything has been done about it.</>}
        watch={<>It reads what people typed into the Feedback button &mdash; it doesn&rsquo;t watch anyone&rsquo;s screen. The digest posts once a night, so something reported this morning appears tomorrow unless you post it now.</>}
      />
      <header className="conn-head" style={{ alignItems: "center" }}>
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", color: "inherit", flex: 1, minWidth: 0 }}>
          <span aria-hidden style={{ transition: "transform .15s", transform: open ? "rotate(90deg)" : "none", opacity: 0.6 }}>&#9654;</span>
          <span style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>Feedback automation {!open && issues.length > 0 && <span className="conn-note" style={{ fontWeight: 400 }}>· {issues.length} item{issues.length === 1 ? "" : "s"}{openCount ? `, ${openCount} queued` : ""}</span>}</h2>
            {open && <p style={{ margin: "4px 0 0" }}>Twice a day, new tester feedback becomes a work item and the agent fixes what it safely can. Run it now, and see what got fixed below.</p>}
          </span>
        </button>
        {open && <button type="button" className="btn primary" onClick={runNow} disabled={running || !configured}>{running ? "Running…" : "Run digest now"}</button>}
      </header>
      {!open ? null : <>
      {message && <p className="notice" role="status">{message}</p>}
      {!configured && <p className="conn-note">Not configured yet — set <code>FEEDBACK_GH_TOKEN</code> (a GitHub token with Issues: read &amp; write) in the environment and redeploy.</p>}

      <div className="fb-auto-list">
        {loading && <p className="conn-note">Loading…</p>}
        {!loading && configured && issues.length === 0 && <p className="conn-note">No feedback work items yet. When testers send feedback, a digest appears here and the agent gets to work.</p>}
        {issues.map((issue) => {
          const fixed = issue.state === "closed";
          return (
            <div key={issue.number} className="fb-auto-item">
              <div className="fb-auto-top">
                <span className={`fb-auto-chip ${fixed ? "is-fixed" : "is-open"}`}>{fixed ? "Fixed" : "Queued"}</span>
                <a href={issue.url} target="_blank" rel="noreferrer" className="fb-auto-title">{issue.title}</a>
                <span className="fb-auto-date">{fixed && issue.closed_at ? `fixed ${when(issue.closed_at)}` : `sent ${when(issue.created_at)}`}</span>
              </div>
              {issue.lastComment
                ? <p className="fb-auto-summary">{issue.lastComment.length > 700 ? issue.lastComment.slice(0, 700) + "…" : issue.lastComment}</p>
                : fixed
                  ? <p className="fb-auto-summary is-quiet">Closed — see the issue on GitHub for details.</p>
                  : <p className="fb-auto-summary is-quiet">Waiting for the fix agent’s next run.</p>}
              <a href={issue.url} target="_blank" rel="noreferrer" className="focus-link">View on GitHub &#8599;</a>
            </div>
          );
        })}
      </div>
      </>}
    </section>
  );
}
