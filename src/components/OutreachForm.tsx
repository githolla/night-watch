"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { OUTREACH_STAGES, type OutreachStage } from "@/lib/outreach";
import { TIER_LABEL, type TargetTier } from "@/lib/target-accounts";

/** Who works this company, where it stands, and whether it is on the reach-out list at all. */
export function OutreachForm({ accountId, tier, outreach, manual, stage, owner, notes, owners }: { accountId: string; tier: TargetTier | string | null; outreach: boolean; manual: boolean | null; stage: OutreachStage; owner: string; notes: string; owners: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState({ stage, owner, notes });
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");
  const tierSaysOutreach = tier === "A1" || tier === "A2";

  async function send(payload: Record<string, unknown>) {
    setState("saving");
    setMessage("");
    try {
      const response = await fetch(`/api/accounts/${accountId}/outreach`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? `Update failed (${response.status})`);
      setState("saved");
      setMessage("Saved.");
      router.refresh();
    } catch (caught) {
      setState("error");
      setMessage(caught instanceof Error ? caught.message : "Update failed");
    }
  }

  return <form className="outreach-form" onSubmit={(event) => { event.preventDefault(); void send({ outreach_stage: draft.stage, outreach_owner: draft.owner || null, outreach_notes: draft.notes || null }); }}>
    <div className="outreach-form-grid">
      <label><span>Stage</span><select value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value as OutreachStage })}>{OUTREACH_STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>Owner</span><input list="outreach-owners" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Who works this company" /><datalist id="outreach-owners">{owners.map((name) => <option key={name} value={name} />)}</datalist></label>
    </div>
    <label><span>Notes</span><textarea rows={4} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Who you spoke to, what they said, what to do next" /></label>
    <div className="outreach-form-actions">
      <button className="btn primary" type="submit" disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save"}</button>
      {outreach
        ? <button className="btn" type="button" disabled={state === "saving"} onClick={() => { if (window.confirm("Take this company off the reach-out list? Open dossiers for it are archived and no new ones are drafted until it is put back.")) void send({ outreach: false }); }}>Take off the reach-out list</button>
        : <button className="btn" type="button" disabled={state === "saving"} onClick={() => send({ outreach: true })}>Put on the reach-out list</button>}
      {manual !== null && <button className="btn" type="button" disabled={state === "saving"} title={`The cut says ${tier ? TIER_LABEL[tier as TargetTier] ?? tier : "no tier"}`} onClick={() => send({ outreach: null })}>Follow the tier ({tierSaysOutreach ? "on the list" : "held"})</button>}
      {message && <span className={state === "error" ? "notice error" : "outreach-form-saved"}>{message}</span>}
    </div>
  </form>;
}
