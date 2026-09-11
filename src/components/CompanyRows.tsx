"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAGE_LABEL, type OutreachStage } from "@/lib/outreach";

export type CompanyRow = {
  id: string | null; domain: string; name: string; industry: string; subSegment: string; hq: string; tier: string; outreach: boolean; manual: boolean;
  intel: number; roles: number; posts: number; contacts: number; verified: number; stage: OutreachStage; owner: string; lastChange: string | null; scanned: boolean; drafts: number; dropReason: string;
};

function shortDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

/** Every company as a clickable row, with the one management action that matters: on the reach-out list or not. */
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

  return <>
    {error && <p className="notice error">{error}</p>}
    <ol className="rank-list company-list">
      {rows.map((row) => <li key={row.domain} className={row.tier === "removed" ? "is-closed" : ""} onClick={() => router.push(`/accounts/${row.domain}`)}>
        <div className="rank-company">
          <strong>{row.name}</strong>
          <small>{row.industry}{row.subSegment ? ` · ${row.subSegment}` : ""}{row.hq ? ` · ${row.hq}` : ""}</small>
          <span className="outreach-chips"><span className={`tier-chip tier-${row.tier}`}>{row.tier === "removed" ? "removed" : row.tier}</span>{row.manual && <span className="tier-chip tier-manual">by hand</span>}{row.drafts > 0 && <span className="tier-chip tier-draft">Draft ready</span>}</span>
        </div>
        <div className="rank-why">
          <p>{row.tier === "removed" && row.dropReason ? row.dropReason : row.scanned ? ([row.roles ? `${row.roles} target ${row.roles === 1 ? "role" : "roles"}` : null, row.posts ? `${row.posts} AI ${row.posts === 1 ? "post" : "posts"}` : null, row.contacts ? `${row.contacts} ${row.contacts === 1 ? "person" : "people"}${row.verified ? ` (${row.verified} verified)` : ""}` : null].filter(Boolean).join(" · ") || "Scanned, nothing found yet") : row.outreach ? "Not scanned yet" : "Held: swept only when asked"}</p>
          <small>{row.outreach ? `${STAGE_LABEL[row.stage]}${row.owner ? ` · ${row.owner}` : ""}` : row.tier === "removed" ? "Not contacted" : "Not contacted until put on the list"}{row.lastChange ? ` · changed ${shortDate(row.lastChange)}` : ""}</small>
        </div>
        <div className="company-score"><b className={`intel-score ${row.intel >= 60 ? "is-hot" : row.intel >= 30 ? "is-warm" : ""}`}>{row.intel}</b></div>
        <div className="company-action" onClick={(event) => event.stopPropagation()}>
          {row.id ? (row.outreach
            ? <button type="button" className="list-toggle is-on" disabled={busy === row.id} onClick={() => toggle(row, false)} title="On the reach-out list. Click to take it off."><i />On the list</button>
            : <button type="button" className="list-toggle" disabled={busy === row.id} onClick={() => toggle(row, true)} title="Held. Click to put it on the reach-out list."><i />Put on list</button>)
            : <span className="tier-chip tier-unsynced">not synced</span>}
        </div>
        <span className="rank-go">→</span>
      </li>)}
      {rows.length === 0 && <li className="outreach-empty">Nothing matches.</li>}
    </ol>
  </>;
}
