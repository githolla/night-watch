"use client";
import { useState } from "react";

type Draft = { id: number; company: string; domain: string; tier: string; subject: string; message: string; sourceUrl: string; signal: string; targetRole?: string; rationale?: string; alternate?: { targetRole: string; subject: string; message: string } };
export function CustomizedEmails({ drafts, greeting, signoff, signature, sender }: { drafts: Draft[]; greeting: string; signoff: string; signature: string; sender: string }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(drafts[0].id);
  const [names, setNames] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState("");
  const [alternateFor, setAlternateFor] = useState<Record<number, boolean>>({});
  const companyDraft = drafts.find((item) => item.id === selected)!;
  const draft = { ...companyDraft, ...(alternateFor[selected] && companyDraft.alternate ? companyDraft.alternate : {}) };
  const name = names[selected] ?? "";
  const salutation = greeting.replace(/\{first\}/gi, name.trim().split(/\s+/)[0] || "[first name]").replace(/\{name\}/gi, name.trim() || "[recipient name]");
  const body = [salutation, draft.message, signoff, signature].filter(Boolean).join("\n\n");
  const matches = drafts.filter((item) => `${item.company} ${item.domain} ${item.subject}`.toLowerCase().includes(search.toLowerCase()));
  async function copy() {
    try { await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${body}`); setCopied("Copied."); }
    catch { setCopied("Clipboard unavailable. Select and copy the preview below."); }
  }
  return <main style={{ maxWidth: 1100, margin: "32px auto", padding: 20 }}>
    <h1>443 customized emails</h1>
    <p>Previewing as <strong>{sender}</strong>, using your saved greeting and signature. <a href="/settings">Edit sender settings</a>.</p>
    <p>Each company has its own subject and message. These drafts use the supplied sales list; verify the source and recipient before sending. Nothing on this page sends an email or replaces a saved worklist draft.</p>
    <label>Find a company <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Company, domain or subject" style={{ width: "100%", padding: 12, margin: "8px 0 16px" }} /></label>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      <aside style={{ flex: "1 1 240px", maxHeight: 620, overflowY: "auto" }} aria-label="Companies">
        <p>{matches.length} companies</p>
        {matches.map((item) => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setCopied(""); }} style={{ display: "block", width: "100%", textAlign: "left", padding: 12, border: "1px solid #d9d3c8", background: selected === item.id ? "#ece6d9" : "transparent" }}>{item.company} <small>· {item.tier}</small></button>)}
      </aside>
      <section style={{ flex: "2 1 400px", minWidth: 0 }}>
        <h2>{draft.company}</h2>
        {companyDraft.alternate && <label>Buyer version <select value={alternateFor[selected] ? "alternate" : "primary"} onChange={event => { setAlternateFor({ ...alternateFor, [selected]: event.target.value === "alternate" }); setCopied(""); }}><option value="primary">{companyDraft.targetRole}</option><option value="alternate">{companyDraft.alternate.targetRole}</option></select></label>}
        <p>{draft.domain}{draft.targetRole ? ` · Written for ${draft.targetRole}` : ""}</p>
        {draft.rationale && <details><summary>Why this angle</summary><p>{draft.rationale}</p></details>}
        <label>Recipient’s verified name <input value={name} onChange={(event) => { setNames({ ...names, [selected]: event.target.value }); setCopied(""); }} placeholder="Enter the person you intend to contact" style={{ width: "100%", padding: 12, margin: "8px 0" }} /></label>
        <p><strong>Subject:</strong> {draft.subject}</p>
        <pre style={{ whiteSpace: "pre-wrap", font: "inherit", lineHeight: 1.7, padding: 20, border: "1px solid #d9d3c8" }}>{body}</pre>
        <button type="button" disabled={!name.trim()} onClick={copy}>Copy email</button> <span role="status">{copied}</span>
        <p><small>Recipient names entered here last only while this page is open.</small></p>
        <details><summary>Source supplied with the list</summary><p>{draft.signal}</p>{/^https?:\/\//i.test(draft.sourceUrl) && <a href={draft.sourceUrl} target="_blank" rel="noreferrer">Review source</a>}</details>
      </section>
    </div>
  </main>;
}
