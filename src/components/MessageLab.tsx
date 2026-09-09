"use client";

import { ArrowRight, Check, FlaskConical, Plus, Sparkles, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createChallenger, simulateHeuristically, type MessageVariant, type SimulationResult } from "@/lib/message-simulation";

type Props = {
  cardId: string;
  demo: boolean;
  channel: "comment" | "connection" | "email";
  personName: string;
  company: string;
  signalSummary: string;
  initialContext: string;
  controlSubject: string;
  controlBody: string;
  onApply: (variant: MessageVariant) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
};

const MAX_FOCUS_AREAS = 5;

export function MessageLab(props: Props) {
  const [goal, setGoal] = useState("Which message is most likely to earn a useful reply without overreaching?");
  const [context, setContext] = useState(props.initialContext.slice(0, 1500));
  const [focusAreas, setFocusAreas] = useState(["signal relevance", "credibility without overclaiming", "low-friction reply"]);
  const [focusInput, setFocusInput] = useState("");
  const [variantA, setVariantA] = useState<MessageVariant>({ label: "A", subject: props.controlSubject, body: props.controlBody });
  const [variantB, setVariantB] = useState<MessageVariant>(() => createChallenger({ channel: props.channel, personName: props.personName, company: props.company, signalSummary: props.signalSummary, control: { label: "A", subject: props.controlSubject, body: props.controlBody } }));
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && props.onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props]);

  function addFocusArea() {
    const value = focusInput.trim().slice(0, 120);
    if (!value || focusAreas.length >= MAX_FOCUS_AREAS || focusAreas.includes(value)) return;
    setFocusAreas((current) => [...current, value]);
    setFocusInput("");
    setResult(null);
  }

  async function runSimulation() {
    setBusy(true);
    setResult(null);
    const input = { channel: props.channel, personName: props.personName, company: props.company, signalSummary: props.signalSummary, goal: goal.trim(), context: context.trim(), focusAreas, variants: [variantA, variantB] as [MessageVariant, MessageVariant] };
    if (props.demo) {
      setResult(simulateHeuristically(input));
      setBusy(false);
      return;
    }
    try {
      const response = await fetch(`/api/cards/${props.cardId}/simulate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Simulation failed");
      setResult(data);
    } catch (error) {
      props.onNotice(error instanceof Error ? error.message : "Simulation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function selectVariant(label: "A" | "B") {
    const variant = label === "A" ? variantA : variantB;
    if (!props.demo && result?.experimentId) {
      const response = await fetch(`/api/cards/${props.cardId}/simulate`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ experimentId: result.experimentId, label }) });
      if (!response.ok) {
        const data = await response.json();
        props.onNotice(data.error ?? "Could not select the variant.");
        return;
      }
    }
    props.onApply(variant);
    props.onNotice(`Variant ${label} is now the active ${props.channel === "email" ? "email" : "LinkedIn message"}. Save it or add it to the cadence when ready.`);
    props.onClose();
  }

  return (
    <div className="lab-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <section className="message-lab" role="dialog" aria-modal="true" aria-labelledby="message-lab-title">
        <header className="lab-head">
          <div className="lab-mark"><FlaskConical /></div>
          <div><span className="eyebrow">Nine—67 / Message Lab</span><h2 id="message-lab-title">Simulate before you send</h2><p>Compare two approaches against a briefed buyer panel. Directional guidance—not a promise of response.</p></div>
          <button type="button" className="lab-close" onClick={props.onClose} aria-label="Close message lab"><X /></button>
        </header>

        <div className="lab-brief">
          <div className="lab-brief-title"><Users /><div><span className="eyebrow">Brief the room</span><strong>Tell the panel what matters</strong></div></div>
          <label><span>Decision to answer</span><input value={goal} onChange={(event) => { setGoal(event.target.value); setResult(null); }} maxLength={240} /></label>
          <label className="lab-context"><span>Background the room receives</span><textarea value={context} onChange={(event) => { setContext(event.target.value); setResult(null); }} rows={3} maxLength={1500} placeholder="The real situation, constraints, and known weaknesses the panel should account for." /></label>
          <div className="focus-builder">
            <span>Focus lenses</span>
            <div className="focus-chips">{focusAreas.map((area) => <button type="button" key={area} onClick={() => { setFocusAreas((current) => current.filter((item) => item !== area)); setResult(null); }}>{area}<X /></button>)}</div>
            <div className="focus-input"><input value={focusInput} disabled={focusAreas.length >= MAX_FOCUS_AREAS} onChange={(event) => setFocusInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addFocusArea(); } }} placeholder={focusAreas.length >= MAX_FOCUS_AREAS ? "Five lenses added" : "Add another lens"} maxLength={120} /><button type="button" onClick={addFocusArea} disabled={!focusInput.trim() || focusAreas.length >= MAX_FOCUS_AREAS}><Plus /> Add</button></div>
          </div>
        </div>

        <div className="variant-grid">
          <VariantEditor variant={variantA} result={result} kicker="Control · current draft" onChange={(value) => { setVariantA(value); setResult(null); }} email={props.channel === "email"} />
          <VariantEditor variant={variantB} result={result} kicker="Challenger · alternate angle" onChange={(value) => { setVariantB(value); setResult(null); }} email={props.channel === "email"} />
        </div>

        {!result ? (
          <div className="lab-runbar"><div><Sparkles /><span><strong>Four simulated perspectives</strong><small>Operator · executive · skeptic · message filter</small></span></div><button type="button" onClick={runSimulation} disabled={busy || !variantA.body.trim() || !variantB.body.trim()}>{busy ? "Running the room…" : "Run A/B simulation"}<ArrowRight /></button></div>
        ) : (
          <div className="lab-results">
            <header><div><span className="eyebrow">Room decision{result.outcomesUsed ? ` · calibrated with ${result.outcomesUsed} past outcomes` : " · first-run baseline"}</span><h3>Variant {result.winner} leads by {Math.abs(result.variants[0].score - result.variants[1].score)} points</h3></div><div className="confidence"><strong>{result.confidence}%</strong><span>directional<br />confidence</span></div></header>
            <div className="result-body">
              <div className="score-comparison">
                {(["relevance", "specificity", "trust", "replyEase"] as const).map((dimension) => <div key={dimension}><span>{dimension === "replyEase" ? "Reply ease" : dimension}</span><ScoreBar label="A" value={result.variants[0].dimensions[dimension]} /><ScoreBar label="B" value={result.variants[1].dimensions[dimension]} /></div>)}
              </div>
              <div className="panel-votes">{result.panel.map((reaction) => <article key={reaction.persona}><span>{reaction.persona}<b>VOTES {reaction.vote}</b></span><strong>{reaction.concern}</strong><p>{reaction.suggestion}</p></article>)}</div>
            </div>
            <footer><span>Winning copy is never sent automatically from the lab.</span><button type="button" onClick={() => selectVariant(result.winner)}><Check /> Use variant {result.winner} in composer<ArrowRight /></button></footer>
          </div>
        )}
      </section>
    </div>
  );
}

function VariantEditor({ variant, result, kicker, onChange, email }: { variant: MessageVariant; result: SimulationResult | null; kicker: string; onChange: (value: MessageVariant) => void; email: boolean }) {
  const scored = result?.variants.find((item) => item.label === variant.label);
  return <article className={`variant-card ${result?.winner === variant.label ? "winner" : ""}`}><header><span><b>{variant.label}</b>{kicker}</span>{scored && <strong>{scored.score}<small>/100</small></strong>}</header>{email && <label><span>Subject</span><input value={variant.subject} onChange={(event) => onChange({ ...variant, subject: event.target.value })} maxLength={120} /></label>}<textarea value={variant.body} onChange={(event) => onChange({ ...variant, body: event.target.value })} rows={8} maxLength={1000} />{scored ? <footer><p>{scored.summary}</p><span>{result?.winner === variant.label ? "PREDICTED WINNER" : "ALTERNATE"}</span></footer> : <footer><span>{variant.body.split(/\s+/).filter(Boolean).length} WORDS</span><span>EDITABLE</span></footer>}</article>;
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return <div className="lab-scorebar"><b>{label}</b><i><span style={{ width: `${value}%` }} /></i><strong>{value}</strong></div>;
}
