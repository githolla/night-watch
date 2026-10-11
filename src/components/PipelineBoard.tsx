"use client";

import Link from "next/link";
import { CompanyLogo } from "@/components/CompanyLogo";
import { useMemo, useState } from "react";
import { InlineConfirm } from "@/components/InlineConfirm";
import { PageHead } from "@/components/PageHead";

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
  { key: "contacted", label: "Emailed", blurb: "first email sent" },
  { key: "replied", label: "Replied", blurb: "wrote back" },
  { key: "meeting", label: "Meeting", blurb: "first call booked" },
  { key: "qualified", label: "Good fit", blurb: "a real need" },
  { key: "opportunity", label: "Deal", blurb: "scoped work" },
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
  contacted: { stage: "replied", label: "They replied (not by email)" },
  replied: { stage: "meeting", label: "Meeting booked" },
  meeting: { stage: "qualified", label: "Good fit" },
  qualified: { stage: "opportunity", label: "Make it a deal" },
};

export function PipelineBoard({ cards }: { cards: PipelineCard[] }) {
  const [list, setList] = useState(cards);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ card: PipelineCard; kind: "opportunity" | "lost" } | null>(null);
  const [value, setValue] = useState("");

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

  async function advance(card: PipelineCard, stage: string, label: string, raw = "") {
    setBusy(card.id); setNotice(null); setAsking(null);
    const digits = raw.replace(/[,$\s]/g, "");
    const valueUsd = /^\d+$/.test(digits) ? Number(digits) : undefined;
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
    setBusy(card.id); setAsking(null);
    try {
      const res = await fetch(`/api/cards/${card.id}/stage`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage: "lost" }) });
      if (res.ok) { setList((cur) => cur.filter((c) => c.id !== card.id)); setNotice(`${card.company}: marked not now.`); }
      else setNotice("Could not update the stage. Try again.");
    } catch { setNotice("Could not update the stage. Try again."); }
    finally { setBusy(null); }
  }
  const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "");

  return <>
    <PageHead title="Pipeline">Everyone you have emailed, from first reply to a real deal. {oppValue > 0 ? `$${oppValue.toLocaleString()} in open deals.` : ""}</PageHead>

    <section className="funnel">
      {STAGES.map((stage, i) => (
        <div key={stage.key} className="funnel-step">
          <div className="funnel-bar"><strong>{counts[stage.key]}</strong><span>{stage.label}</span><small>{stage.blurb}</small></div>
          {i > 0 && rate(counts[stage.key], counts[STAGES[i - 1].key]) && <em className="funnel-rate">{rate(counts[stage.key], counts[STAGES[i - 1].key])}</em>}
        </div>
      ))}
    </section>

    {notice && <p className="notice">{notice}</p>}

    <div className="pipe-cols">
      {STAGES.map((stage) => (
        <section key={stage.key} className="pipe-col">
          <h2 className="pipe-col-head">{stage.label}<b>{byStage[stage.key].length}</b></h2>
          <div className="pipe-col-list">
            {byStage[stage.key].length === 0 && <p className="pipe-empty">No one here yet</p>}
            {byStage[stage.key].map((card) => {
              const next = NEXT[stage.key];
              return (
                <div key={card.id} className="pipe-card">
                  <div className="pipe-card-id"><span className="pipe-card-co"><CompanyLogo domain={card.domain} name={card.company} size={24} /><strong>{card.company}</strong></span><small>{card.person}{card.title ? ` · ${card.title}` : ""}</small></div>
                  {card.valueUsd ? <div className="pipe-card-val">${card.valueUsd.toLocaleString()}</div> : null}
                  <div className="pipe-card-actions">
                    <Link href={`/brief/${card.id}`} className="pipe-link">Call brief</Link>
                    <Link href={`/accounts/${encodeURIComponent(card.domain)}`} className="pipe-link">Company</Link>
                    {next && <button type="button" disabled={busy === card.id} onClick={() => { if (next.stage === "opportunity") { setValue(""); setAsking({ card, kind: "opportunity" }); } else void advance(card, next.stage, next.label); }}>{next.label} →</button>}
                    <button type="button" className="pipe-lost" disabled={busy === card.id} onClick={() => setAsking({ card, kind: "lost" })}>Not now</button>
                  </div>
                  {asking?.card.id === card.id && asking.kind === "lost" && <InlineConfirm title={`Mark ${card.company} as not now?`} yes="Yes, not now" busy={busy === card.id} onYes={() => void markLost(card)} onCancel={() => setAsking(null)}>It leaves the pipeline. Their history stays on file.</InlineConfirm>}
                  {asking?.card.id === card.id && asking.kind === "opportunity" && next && <InlineConfirm title="Make this a deal?" yes="Make it a deal" busy={busy === card.id} onYes={() => void advance(card, next.stage, next.label, value)} onCancel={() => setAsking(null)}>
                    <label className="inline-confirm-field"><span>Rough value in dollars (optional)</span><input inputMode="numeric" value={value} onChange={(event) => setValue(event.target.value)} placeholder="25,000" /></label>
                  </InlineConfirm>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  </>;
}
