"use client";

import { useEffect, useState } from "react";

type Issue = { number: number; title: string; state: string; url: string; created_at: string; closed_at: string | null; comments: number; lastComment: string | null };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Admin view of the feedback → auto-fix loop: run the digest on demand, and see what the agent fixed. */
export function FeedbackAutomation() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

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

  return (
    <section className="conn-card">
      <header className="conn-head">
        <div>
          <h2>Feedback automation</h2>
          <p>Twice a day, new tester feedback becomes a work item and the agent fixes what it safely can. Run it now, and see what got fixed below.</p>
        </div>
        <button type="button" className="btn primary" onClick={runNow} disabled={running || !configured}>{running ? "Running…" : "Run digest now"}</button>
      </header>
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
    </section>
  );
}
