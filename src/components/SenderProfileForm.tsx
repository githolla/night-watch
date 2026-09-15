"use client";

import { useState } from "react";

type Profile = { from_name: string; title: string; signature: string; cc: string[] };

/**
 * The identity outreach emails present as: the name and title on the From line, the CC list, and the signature
 * appended to every send. The mailbox is whichever Gmail is connected; this only controls how it reads.
 */
export function SenderProfileForm({ initial, senderEmail }: { initial: Profile; senderEmail: string | null }) {
  const [fromName, setFromName] = useState(initial.from_name);
  const [title, setTitle] = useState(initial.title);
  const [signature, setSignature] = useState(initial.signature);
  const [cc, setCc] = useState(initial.cc.join(", "));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const fromLine = [fromName, title].filter((part) => part.trim()).join(", ");
  const preview = fromLine ? `${fromLine} <${senderEmail ?? "your@mailbox"}>` : (senderEmail ?? "Connect a mailbox to send");

  async function save() {
    setState("saving");
    setError("");
    const list = cc.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch("/api/settings/sender", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from_name: fromName, title, signature, cc: list }) });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) { setState("error"); setError(json.error ?? "Could not save."); return; }
      setState("saved");
    } catch { setState("error"); setError("Could not save."); }
  }

  return (
    <section className="card pad sender-profile">
      <div className="card-title"><div><span className="overview-kick">Outreach identity</span><h2>How your emails present</h2></div></div>
      <p className="sender-profile-lead">Every outreach email — sent by hand or by the automated cadence — goes out from the connected mailbox with this name, title, CC and signature. It does not change which mailbox sends.</p>
      <div className="sender-profile-grid">
        <label><span>Sender name</span><input value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Suuchi Ramesh" maxLength={120} /></label>
        <label><span>Title (shown on the From line)</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Founder & CEO" maxLength={120} /></label>
      </div>
      <label className="sender-profile-full"><span>CC (comma-separated — the team gets a copy of every send)</span><input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="josh@nine-67.com, diego@nine-67.com" /></label>
      <label className="sender-profile-full"><span>Signature (appended to every email)</span><textarea value={signature} onChange={(event) => setSignature(event.target.value)} rows={4} placeholder={"Suuchi Ramesh\nFounder & CEO, Nine-67\nnine-67.com"} maxLength={2000} /></label>
      <p className="sender-profile-preview"><span>Recipients see</span><code>{preview}</code></p>
      <div className="sender-profile-actions">
        <button type="button" className="btn primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save identity"}</button>
        {state === "saved" && <span className="sender-profile-ok">Saved.</span>}
        {state === "error" && <span className="sender-profile-err">{error}</span>}
      </div>
    </section>
  );
}
