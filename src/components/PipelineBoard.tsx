"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type PipelineCard = {
  id: string;
  status: string;
  score: number;
  company: string;
  domain: string;
  person: string;
  title: string;
  valueUsd: number | null;
  reached: { contacted: boolean; replied: boolean; meeting: boolean; qualified: boolean; opportunity: boolean };
};

const STAGES = [
  { key: "contacted", label: "Contacted", blurb: "outreach sent" },
  { key: "replied", label: "Replied", blurb: "wrote back" },
  { key: "meeting", label: "Discovery", blurb: "meeting booked" },
  { key: "qualified", label: "Qualified", blurb: "real fit" },
  { key: "opportunity", label: "Opportunity", blurb: "scoped deal" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

// The furthest stage a card has reached, for placing it in one column.
function currentStage(card: PipelineCard): StageKey {
  if (card.reached.opportunity) return "opportunity";
  if (card.reached.qualified) return "qualified";
  if (card.reached.meeting) return "meeting";
  if (card.reached.replied) return "replied";
  return "contacted";
}
const NEXT: Partial<Record<StageKey, { stage: string; label: string }>> = {
  contacted: { stage: "replied", label: "Mark replied" },
  replied: { stage: "meeting", label: "Booked discovery" },
  meeting: { stage: "qualified", label: "Mark qualified" },
  qualified: { stage: "opportunity", label: "Create opportunity" },
};

export function PipelineBoard({ cards }: { cards: PipelineCard[] }) {
  const [list, setList] = useState(cards);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const stage of STAGES) c[stage.key] = list.filter((card) => card.reached[stage.key]).length;
    return c;
  }, [list]);
  const oppValue = useMemo(() => list.filter((c) => c.reached.opportunity).reduce((sum, c) => sum + (c.valueUsd ?? 0), 0), [list]);
  const byStage = useMemo(() => {
    const map: Record<StageKey, PipelineCard[]> = { contacted: [], replied: [], meeting: [], qualified: [], opportunity: [] };
    for (const card of list) map[currentStage(card)].push(card);
    return map;
  }, [list]);

  async function advance(card: PipelineCard, stage: string, label: string) {
    setBusy(card.id); setNotice(null);
    let valueUsd: number | undefined;
    if (stage === "opportunity") {
      const raw = prompt("Rough opportunity value (USD, optional):", "");
      if (raw && /^\d+$/.test(raw.replace(/[,$\s]/g, ""))) valueUsd = Number(raw.replace(/[,$\s]/g, ""));
    }
    try {
      const res = await fetch(`/api/cards/${card.id}/stage`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage, valueUsd }) });
      const json = await res.json();
      if (!res.ok) { setNotice(json.error ?? "Could not update the stage."); return; }
      setList((cur) => cur.map((c) => c.id === card.id ? { ...c, valueUsd: valueUsd ?? c.valueUsd, reached: { ...c.reached, replied: true, meeting: c.reached.meeting || stage === "meeting" || ["qualified", "opportunity"].includes(stage), qualified: c.reached.qualified || ["qualified", "opportunity"].includes(stage), opportunity: c.reached.opportunity || stage === "opportunity" } } : c));
      setNotice(`${card.company}: ${label.toLowerCase()}.`);
    } catch { setNotice("Could not update the stage."); }
    finally { setBusy(null); }
  }
  async function markLost(card: PipelineCard) {
    if (!confirm(`Mark ${card.company} as lost / not now?`)) return;
    setBusy(card.id);
    try {
      const res = await fetch(`/api/cards/${card.id}/stage`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "lost" }) });
      if (res.ok) setList((cur) => cur.filter((c) => c.id !== card.id));
    } finally { setBusy(null); }
  }
  const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

  return <>
    <header className="page-head briefing-head">
      <div><span className="overview-kick">Conversion</span><h1>What happens after outreach</h1><p>Every contacted prospect, tracked from reply through discovery, qualification and opportunity. {oppValue > 0 ? `$${oppValue.toLocaleString()} in open opportunities.` : ""}</p></div>
    </header>

    <section className="funnel">
      {STAGES.map((stage, i) => (
        <div key={stage.key} className="funnel-step">
          <div className="funnel-bar"><strong>{counts[stage.key]}</strong><span>{stage.label}</span><small>{stage.blurb}</small></div>
          {i > 0 && <em className="funnel-rate">{rate(counts[stage.key], counts[STAGES[i - 1].key])}</em>}
        </div>
      ))}
    </section>

    {notice && <p className="notice">{notice}</p>}

    <div className="pipe-cols">
      {STAGES.map((stage) => (
        <section key={stage.key} className="pipe-col">
          <h2 className="pipe-col-head">{stage.label}<b>{byStage[stage.key].length}</b></h2>
          <div className="pipe-col-list">
            {byStage[stage.key].length === 0 && <p className="pipe-empty">—</p>}
            {byStage[stage.key].map((card) => {
              const next = NEXT[stage.key];
              return (
                <div key={card.id} className="pipe-card">
                  <div className="pipe-card-id"><strong>{card.company}</strong><small>{card.person}{card.title ? ` · ${card.title}` : ""}</small></div>
                  {card.valueUsd ? <div className="pipe-card-val">${card.valueUsd.toLocaleString()}</div> : null}
                  <div className="pipe-card-actions">
                    <Link href={`/brief/${card.id}`} className="pipe-link">Call brief</Link>
                    <Link href={`/desk?card=${card.id}`} className="pipe-link">Open</Link>
                    {next && <button type="button" disabled={busy === card.id} onClick={() => advance(card, next.stage, next.label)}>{next.label} →</button>}
                    <button type="button" className="pipe-lost" disabled={busy === card.id} onClick={() => markLost(card)}>Lost</button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  </>;
}
