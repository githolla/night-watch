"use client";

import { useEffect, useState } from "react";

type Window = { total: number; bySource: Record<string, number>; tracked: boolean };
type Spend = { today: Window; week: Window; month: Window };

const LABEL: Record<string, string> = {
  research: "Company research",
  analysis: "Deep analysis",
  rewrite_drafts: "Regenerating drafts",
  refine_draft: "Refine on a draft",
  message_lab: "Message Lab",
};

const money = (value: number) => `$${value.toFixed(2)}`;

/** What the app has spent, and — just as important — whether it is seeing all of it. */
export function SpendPanel() {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/admin/spend", { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => { if (!live) return; if (json.error) setError(json.error); else setSpend(json as Spend); })
      .catch(() => { if (live) setError("Could not read spend."); });
    return () => { live = false; };
  }, []);

  if (error) return <section className="conn-card"><div className="conn-head"><h2>API spend</h2></div><p className="conn-note">{error}</p></section>;
  if (!spend) return <section className="conn-card"><div className="conn-head"><h2>API spend</h2></div><p className="conn-note">Loading…</p></section>;

  const today = spend.today;
  const rows = Object.entries(today.bySource).sort((a, b) => b[1] - a[1]);

  return (
    <section className="conn-card">
      <div className="conn-head"><h2>API spend</h2></div>
      <div className="spend-row">
        <div className="spend-figure"><span>Today</span><strong>{money(today.total)}</strong></div>
        <div className="spend-figure"><span>Last 7 days</span><strong>{money(spend.week.total)}</strong></div>
        <div className="spend-figure"><span>Last 30 days</span><strong>{money(spend.month.total)}</strong></div>
      </div>

      {!today.tracked && (
        <p className="panel-watch">
          Only the research pipeline is being counted. Regenerating drafts, Refine and the Message Lab all
          call the model and are <strong>not recorded yet</strong>, so your real bill is higher than the
          figure above. Apply <code>supabase/repair/0024_api_spend.sql</code> in the Supabase SQL editor to
          start counting them &mdash; no deploy needed.
        </p>
      )}

      {rows.length > 0 ? (
        <table className="spend-table">
          <tbody>
            {rows.map(([source, value]) => (
              <tr key={source}><td>{LABEL[source] ?? source}</td><td>{money(value)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : <p className="conn-note">Nothing spent today.</p>}

      <p className="conn-note">Measured from the tokens and web searches each call actually used. Compare it with the Anthropic console: a gap means something is still spending without recording.</p>
    </section>
  );
}
