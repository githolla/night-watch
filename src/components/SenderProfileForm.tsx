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
  const [uploadErr, setUploadErr] = useState("");

  // True when the signature field holds real HTML (a pasted/uploaded signature) vs plain text.
  const isHtmlSig = /<[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(signature.trim());
  // Preview-only sanitize: strip scripts/handlers so pasting HTML can't run in the admin's browser. The
  // outbound email keeps the raw HTML (email clients sanitize on their end).
  const previewHtml = signature
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/ on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadErr("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 20000) { setUploadErr("That file is over 20KB — use a hosted image URL in the signature rather than an embedded one."); return; }
    try { setSignature((await file.text()).trim()); } catch { setUploadErr("Couldn't read that file."); }
    event.target.value = "";
  }

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
      <label className="sender-profile-full">
        <span>Your signature — paste your own HTML signature to use it as-is (it overrides the built-in block), or plain text as a fallback</span>
        <textarea value={signature} onChange={(event) => setSignature(event.target.value)} rows={isHtmlSig ? 8 : 3} placeholder={"Paste an HTML signature, or plain text like:\nJosh Lee\nFDE, COO, Nine-67\nnine-67.com"} maxLength={20000} style={isHtmlSig ? { fontFamily: "var(--mono, monospace)", fontSize: 12 } : undefined} />
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "-4px 0 4px" }}>
        <label className="btn" style={{ cursor: "pointer" }}>
          Upload signature (.html)
          <input type="file" accept=".html,.htm,.txt,text/html" onChange={onUpload} style={{ display: "none" }} />
        </label>
        {isHtmlSig && <button type="button" className="btn ghost" onClick={() => setSignature("")}>Clear &amp; use built-in block</button>}
        <span className="sender-profile-lead" style={{ margin: 0 }}>{isHtmlSig ? "Using your uploaded HTML signature." : "Using the built-in Nine-67 block below."}</span>
        {uploadErr && <span className="sender-profile-err">{uploadErr}</span>}
      </div>
      <p className="sender-profile-preview"><span>From line</span><code>{preview}</code></p>
      {isHtmlSig
        ? <div className="sig-preview" aria-label="Signature preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        : <div className="sig-preview" aria-label="Signature preview">
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
          </div>}
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
