"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAGE_LABEL, type OutreachStage } from "@/lib/outreach";

export type CompanyRow = {
  id: string | null; domain: string; name: string; industry: string; subSegment: string; hq: string; tier: string; outreach: boolean; manual: boolean;
  intel: number; roles: number; posts: number; contacts: number; verified: number; stage: OutreachStage; owner: string; lastChange: string | null; scanned: boolean; drafts: number; dropReason: string;
};

function ago(value: string | null) {
  if (!value) return "—";
  const days = Math.floor((Date.now() - Date.parse(value)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1d ago" : days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

/** Every company as a table row that opens the company, with one switch: on the reach-out list or not. */
export function CompanyRows({ rows }: { rows: CompanyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(row: CompanyRow, next: boolean) {
    if (!row.id) return;
    if (!next && !window.confirm(`Take ${row.name} off the reach-out list? Open drafts are archived and no new ones are written until it is put back.`)) return;
    setBusy(row.id);
    setError(null);
    try {
      const response = await fetch(`/api/accounts/${row.id}/outreach`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ outreach: next }) });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? `Update failed (${response.status})`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return <div className="table-wrap">
    {error && <p className="notice error">{error}</p>}
    <table className="data-table">
      <thead><tr><th>Company</th><th>Found</th><th>Status</th><th className="col-num">Score</th><th>Changed</th><th>Reach-out list</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.domain} className={row.tier === "removed" ? "is-closed" : ""} onClick={() => router.push(`/accounts/${row.domain}`)}>
          <td><div className="cell-company"><span className="avatar">{initials(row.name)}</span><div><strong>{row.name}</strong><small>{row.industry}{row.hq ? ` · ${row.hq}` : ""} · {row.tier === "removed" ? "removed" : row.tier}{row.manual ? " · by hand" : ""}</small></div></div></td>
          <td className="cell-why"><span>{row.tier === "removed" && row.dropReason ? row.dropReason : row.scanned ? ([row.roles ? `${row.roles} target ${row.roles === 1 ? "role" : "roles"}` : null, row.posts ? `${row.posts} AI ${row.posts === 1 ? "post" : "posts"}` : null, row.contacts ? `${row.contacts} ${row.contacts === 1 ? "person" : "people"}${row.verified ? ` (${row.verified} verified)` : ""}` : null].filter(Boolean).join(" · ") || "Scanned, nothing found yet") : row.outreach ? "Not scanned yet" : "Held: swept only when asked"}</span>{row.drafts > 0 && <em className="pill pill-ink"><i />Draft ready</em>}</td>
          <td>{row.outreach ? <><span className={`pill pill-${row.stage === "untouched" ? "muted" : ["replied", "meeting", "won"].includes(row.stage) ? "ok" : row.stage === "contacted" ? "accent" : ["lost", "hold"].includes(row.stage) ? "muted" : "info"}`}><i />{STAGE_LABEL[row.stage]}</span>{row.owner && <small className="cell-sub">{row.owner}</small>}</> : <span className="pill pill-muted"><i />{row.tier === "removed" ? "Removed" : "Held"}</span>}</td>
          <td className="col-num"><b className={`score ${row.intel >= 60 ? "is-hot" : row.intel >= 30 ? "is-warm" : ""}`}>{row.intel}</b></td>
          <td className="cell-time">{ago(row.lastChange)}</td>
          <td onClick={(event) => event.stopPropagation()}>
            {row.id ? <button type="button" className={`switch ${row.outreach ? "is-on" : ""}`} disabled={busy === row.id} onClick={() => toggle(row, !row.outreach)} title={row.outreach ? "On the reach-out list. Click to take it off." : "Held. Click to put it on the reach-out list."}><i /><span>{row.outreach ? "On the list" : "Off"}</span></button> : <small className="cell-sub">not synced</small>}
          </td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={6} className="cell-empty">Nothing matches.</td></tr>}
      </tbody>
    </table>
  </div>;
}
