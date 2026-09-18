"use client";

import { useState } from "react";

type Profile = { from_name: string; title: string; signature: string; website: string; location: string; cc: string[] };

/**
 * The identity outreach emails present as: the name and title on the From line, the CC list, and the signature
 * appended to every send. The mailbox is whichever Gmail is connected; this only controls how it reads.
 */
export function SenderProfileForm({ initial, senderEmail }: { initial: Profile; senderEmail: string | null }) {
  const [fromName, setFromName] = useState(initial.from_name);
  const [title, setTitle] = useState(initial.title);
  const [website, setWebsite] = useState(initial.website);
  const [location, setLocation] = useState(initial.location);
  const [signature, setSignature] = useState(initial.signature);
  const [cc, setCc] = useState(initial.cc.join(", "));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  async function sendTest() {
    setTesting(true); setTestMsg("");
    try {
      const response = await fetch("/api/gmail/test", { method: "POST" });
      const json = await response.json().catch(() => ({}));
      setTestMsg(response.ok ? `Test sent to ${json.to} — check your inbox.` : (json.error ?? "Could not send the test."));
    } catch { setTestMsg("Could not send the test."); }
    finally { setTesting(false); }
  }

  const fromLine = [fromName, title].filter((part) => part.trim()).join(", ");
  const preview = fromLine ? `${fromLine} <${senderEmail ?? "your@mailbox"}>` : (senderEmail ?? "Connect a mailbox to send");

  async function save() {
    setState("saving");
    setError("");
    const list = cc.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean);
    try {
      const response = await fetch("/api/settings/sender", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from_name: fromName, title, signature, website, location, cc: list }) });
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
        <label><span>Title (shown on the From line & signature)</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="FDE, COO" maxLength={120} /></label>
        <label><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="www.nine-67.com" maxLength={160} /></label>
        <label><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Pennsylvania, USA | ET (UTC-5 / UTC-4)" maxLength={160} /></label>
      </div>
      <label className="sender-profile-full"><span>CC (comma-separated — the team gets a copy of every send)</span><input value={cc} onChange={(event) => setCc(event.target.value)} placeholder="josh@nine-67.com, diego@nine-67.com" /></label>
      <label className="sender-profile-full"><span>Fallback signature (used only if you leave the name above blank)</span><textarea value={signature} onChange={(event) => setSignature(event.target.value)} rows={3} placeholder={"Josh Lee\nFDE, COO, Nine-67\nnine-67.com"} maxLength={2000} /></label>
      <p className="sender-profile-preview"><span>From line</span><code>{preview}</code></p>
      <div className="sig-preview" aria-label="Signature preview">
        <table><tbody><tr>
          <td className="sig-mark">Nine&#8209;67</td>
          <td className="sig-body">
            <div className="sig-name">{fromName || "Your name"}</div>
            {title && <div className="sig-title">{title}</div>}
            <div className="sig-lines">
              <div>✉&nbsp;&nbsp;{senderEmail ?? "you@nine-67.com"}</div>
              {website && <div>◎&nbsp;&nbsp;{website}</div>}
              {location && <div>⌖&nbsp;&nbsp;{location}</div>}
            </div>
          </td>
        </tr></tbody></table>
      </div>
      <div className="sender-profile-actions">
        <button type="button" className="btn primary" onClick={save} disabled={state === "saving"}>{state === "saving" ? "Saving…" : "Save identity"}</button>
        <button type="button" className="btn" onClick={sendTest} disabled={testing} title="Send a sample email to your own inbox">{testing ? "Sending…" : "Send test to myself"}</button>
        {state === "saved" && <span className="sender-profile-ok">Saved.</span>}
        {state === "error" && <span className="sender-profile-err">{error}</span>}
        {testMsg && <span className={/check your inbox/.test(testMsg) ? "sender-profile-ok" : "sender-profile-err"}>{testMsg}</span>}
      </div>
      <p className="sender-profile-lead" style={{ marginTop: 8 }}>Tip: <strong>Save identity</strong> first, then <strong>Send test to myself</strong> to preview a real send in your own inbox before emailing prospects.</p>
    </section>
  );
}
