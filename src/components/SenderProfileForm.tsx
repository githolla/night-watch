"use client";

import { useRef, useState } from "react";
import { PanelGuide } from "./PanelGuide";
import { sanitizeSignatureHtml } from "@/lib/clean";

type Profile = { from_name: string; title: string; signature: string; website: string; location: string; postal_address: string; cc: string[]; greeting: string; signoff: string; intro: string };

/**
 * The identity outreach emails present as: the name and title on the From line, the CC list, and the signature
 * appended to every send. The mailbox is whichever Gmail is connected; this only controls how it reads.
 */
export function SenderProfileForm({ initial, senderEmail }: { initial: Profile; senderEmail: string | null }) {
  const [fromName, setFromName] = useState(initial.from_name);
  const [title, setTitle] = useState(initial.title);
  const [website, setWebsite] = useState(initial.website);
  const [location, setLocation] = useState(initial.location);
  const [postalAddress, setPostalAddress] = useState(initial.postal_address);
  const [signature, setSignature] = useState(initial.signature);
  const [cc, setCc] = useState(initial.cc.join(", "));
  const [greeting, setGreeting] = useState(initial.greeting);
  const [signoff, setSignoff] = useState(initial.signoff);
  const [intro, setIntro] = useState(initial.intro);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const [testTo, setTestTo] = useState("");
  const [uploadErr, setUploadErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const payload = { from_name: fromName, title, signature, website, location, postal_address: postalAddress, cc: cc.split(/[,\s]+/).map(value => value.trim()).filter(Boolean), greeting, signoff, intro };
  const serialized = JSON.stringify(payload);
  const [saved, setSaved] = useState(() => JSON.stringify({ from_name: initial.from_name, title: initial.title, signature: initial.signature, website: initial.website, location: initial.location, postal_address: initial.postal_address, cc: initial.cc, greeting: initial.greeting, signoff: initial.signoff, intro: initial.intro }));
  const dirty = serialized !== saved;
  const testInFlight = useRef(false);

  // True when the signature field holds real HTML (a pasted/uploaded signature) vs plain text.
  const isHtmlSig = /<[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(signature.trim());
  // Same sanitizer the server applies on save and on render — one definition, so the preview can't show
  // something safer than what is stored. The previous hand-rolled version missed `<img src=x/onerror=…>`.
  const previewHtml = sanitizeSignatureHtml(signature);
  const postalPreview = postalAddress.trim().replace(/\s*\n\s*/g, ", ");
  // A <style> block or an external stylesheet is removed on save: CSS can carry its own ways of loading
  // and executing things, so only styles written on the element itself survive. Say so, because otherwise
  // the signature simply renders in the wrong font and colour with no explanation.
  const usesStylesheet = /<\s*style\b|<\s*link\b[^>]*stylesheet/i.test(signature);

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    setUploadErr("");
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 20000) { setUploadErr("That file is over 20KB — use a hosted image URL in the signature rather than an embedded one."); return; }
    setUploading(true);
    try { setSignature((await file.text()).trim()); } catch { setUploadErr("Couldn't read that file."); } finally { setUploading(false); }
    event.target.value = "";
  }

  async function sendTest() {
    if (testInFlight.current || state === "saving" || uploading) return;
    testInFlight.current = true;
    setTesting(true); setTestMsg("");
    try {
      if (dirty && !(await save())) { setTestMsg("Test not sent. Save your settings successfully first."); return; }
      const response = await fetch("/api/gmail/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: testTo.trim() }) });
      const json = await response.json().catch(() => ({}));
      if (response.ok && json.ok === true && typeof json.threadId === "string" && json.threadId.trim() && typeof json.to === "string" && json.to.trim()) {
        // Gmail files a message the API sends to its own mailbox under Sent, never the inbox.
        setTestMsg(json.toSelf ? `Test sent from ${json.to} to itself. Gmail keeps those under Sent, not Inbox: look in Sent, or enter another address to see it arrive.` : `Test sent from ${json.from ?? "this seat"} to ${json.to}. Check that inbox.`);
      } else if (!response.ok && typeof json.error === "string" && response.status < 500) {
        setTestMsg(json.error);
      } else {
        setTestMsg("Test delivery is unknown. Check your inbox and Gmail Sent before trying again.");
      }
    } catch { setTestMsg("Test delivery is unknown. Check your inbox and Gmail Sent before trying again."); }
    finally { testInFlight.current = false; setTesting(false); }
  }

  const fromLine = [fromName, title].filter((part) => part.trim()).join(", ");
  const preview = fromLine ? `${fromLine} <${senderEmail ?? "your@mailbox"}>` : (senderEmail ?? "Connect a mailbox to send");

  async function save() {
    setState("saving");
    setError("");
    setWarning("");
    try {
      const response = await fetch("/api/settings/sender", { method: "POST", headers: { "content-type": "application/json" }, body: serialized });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok !== true) { setState("error"); setError(json.error ?? "Could not save."); return false; }
      // A save can succeed in part: the greeting columns arrive with a repair script the operator runs by
      // hand, and saying "Saved" over the top of that would be a lie.
      setWarning((json.warning as string) ?? "");
      setState("saved");
      if (json.warning) return false;
      setSaved(serialized);
      return true;
    } catch { setState("error"); setError("Could not save."); return false; }
  }

  return (
    <section className="card pad sender-profile">
      <div className="card-title"><div><span className="overview-kick">Outreach identity</span><h2>How your emails present</h2></div></div>
      <PanelGuide
        what="Sets how your emails look to the person receiving them: the name and title on the From line, anyone CC'd, and the signature at the bottom."
        when={<>Before your first send, and whenever your title or signature changes. Press <strong>Save and send test to myself</strong> after making changes to see a real one land in your own inbox.</>}
        watch={<>This is how the email <em>reads</em>, not where it sends from &mdash; the mailbox is whichever Google account is connected above. Paste your own HTML signature to use it as-is; leave it empty and the built-in Nine&#8209;67 block is used instead.</>}
      />
      <fieldset disabled={state === "saving" || testing || uploading} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="sender-profile-grid">
        <label><span>Sender name</span><input value={fromName} onChange={(event) => setFromName(event.target.value)} placeholder="Suuchi Ramesh" maxLength={120} /></label>
        <label><span>Title (shown on the From line & signature)</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="FDE, COO" maxLength={120} /></label>
        <label><span>Website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="www.nine-67.com" maxLength={160} /></label>
        <label><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Pennsylvania, USA | ET (UTC-5 / UTC-4)" maxLength={160} /></label>
        <label><span>Business postal address</span><input value={postalAddress} onChange={(event) => setPostalAddress(event.target.value)} placeholder="123 Main St, Suite 400, Pittsburgh, PA 15222" maxLength={240} /><small>Printed in small type under every email. Required by US law for commercial email, and the morning auto-send stays off until it is set.</small></label>
      </div>
      <div className="sender-profile-grid">
        <label><span>Greeting &mdash; how your drafts open</span><input value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder="Hi {first}," maxLength={160} /></label>
        <label><span>Legacy sign-off (not used in reach-out emails)</span><input value={signoff} onChange={(event) => setSignoff(event.target.value)} placeholder="Thank you," maxLength={160} /></label>
      </div>
      <label className="sender-profile-full"><span>Introduction &mdash; the first line of the message</span><input value={intro} onChange={(event) => setIntro(event.target.value)} placeholder="I am {name}, {title} at Nine-67." maxLength={300} /></label>
      {!fromName.trim() && <p className="sender-profile-warn">Set a sender name above, or your drafts cannot introduce you &mdash; they open &ldquo;I am with Nine-67.&rdquo; instead, which is why the sender appears in some emails and not others.</p>}
      <p className="sender-profile-note">Yours alone &mdash; the drafts written for your worklist open and close the way you do, and another seat&rsquo;s open the way they do. Write <code>{"{first}"}</code> where the contact&rsquo;s first name goes and <code>{"{name}"}</code> for their full name: <em>Hi {"{first}"},</em> reaches Ara as <em>Hi Ara,</em>. Leave any of them blank for <em>Hi {"{first}"},</em>, <em>Thank you,</em> and <em>I am {"{name}"}, {"{title}"} at Nine-67.</em> In the introduction, <code>{"{name}"}</code> and <code>{"{title}"}</code> are your own.</p>

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
      {usesStylesheet && <p className="panel-watch">This signature sets its font and colour in a <code>&lt;style&gt;</code> block, which is removed for safety &mdash; so it will render in the wrong font. Re-export it with <strong>inline styles</strong> (<code>style=&quot;font-family:…;color:…&quot;</code> on each element), which most email clients produce by default and which is kept exactly as pasted.</p>}
      <p className="sender-profile-preview"><span>From line</span><code>{preview}</code></p>
      {isHtmlSig
        ? <div className="sig-preview" aria-label="Signature preview"><div dangerouslySetInnerHTML={{ __html: previewHtml }} />{postalPreview && <div className="sig-postal">{postalPreview}</div>}</div>
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
                  {postalPreview && <div>⌂&nbsp;&nbsp;{postalPreview}</div>}
                </div>
              </td>
            </tr></tbody></table>
          </div>}
      </fieldset>
      <div className="sender-profile-actions">
        <button type="button" className="btn primary" onClick={save} disabled={state === "saving" || testing || uploading}>{state === "saving" ? "Saving…" : "Save identity"}</button>
        <label className="sender-profile-test-to"><span>Send test to</span><input type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="Any inbox; blank sends to you" maxLength={254} /></label>
        <button type="button" className="btn" onClick={sendTest} disabled={testing || state === "saving" || uploading} title="Send a sample email from this seat's mailbox">{testing ? "Sending…" : (dirty ? "Save and send test" : "Send test")}</button>
        {dirty && <span className="sender-profile-warn">Unsaved changes.</span>}
        {state === "saved" && !dirty && (warning ? <span className="sender-profile-warn">{warning}</span> : <span className="sender-profile-ok">Saved.</span>)}
        {state === "error" && <span className="sender-profile-err">{error}</span>}
        {testMsg && <span className={testMsg.startsWith("Test sent") ? "sender-profile-ok" : "sender-profile-err"}>{testMsg}</span>}
      </div>
      <p className="sender-profile-lead" style={{ marginTop: 8 }}>Testing saves any changed settings first. If saving fails, no test is sent.</p>
    </section>
  );
}
