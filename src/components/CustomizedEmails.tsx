"use client";
import { emailStyle, emailFirstName } from "@/lib/email-style";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Draft = { recipientName?: string; buyerSourceUrl?: string; id: number; company: string; domain: string; tier: string; subject: string; message: string; sourceUrl: string; signal: string; targetRole?: string; rationale?: string; alternate?: { targetRole: string; subject: string; message: string } };
export function CustomizedEmails({ drafts, greeting, signoff, signature, sender, curated = false }: { curated?: boolean; drafts: Draft[]; greeting: string; signoff: string; signature: string; sender: string }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(drafts[0].id);
  const [names, setNames] = useState<Record<number, string>>({});
  const [copied, setCopied] = useState("");
  const [opening, setOpening] = useState(false);
  async function openDraft() {
    setOpening(true);
    try {
      const response = await fetch("/api/desk/priority-draft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: draft.domain }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not open the draft");
      router.push(`/desk?card=${result.id}`);
    } catch (error) { setCopied(error instanceof Error ? error.message : "Could not open draft"); setOpening(false); }
  }
  const [alternateFor, setAlternateFor] = useState<Record<number, boolean>>({});
  const companyDraft = drafts.find((item) => item.id === selected)!;
  const draft = { ...companyDraft, ...(alternateFor[selected] && companyDraft.alternate ? companyDraft.alternate : {}) };
  const name = companyDraft.recipientName ?? names[selected] ?? "";
  const salutation = greeting.replace(/\{first\}/gi, name.trim() ? emailFirstName(name) : "[first name]").replace(/\{name\}/gi, name.trim() || "[recipient name]");
  const body = emailStyle([salutation, draft.message, signoff, signature].filter(Boolean).join("\n\n"));
  const matches = drafts.filter((item) => `${item.company} ${item.domain} ${item.subject}`.toLowerCase().includes(search.toLowerCase()));
  async function copy() {
    try { await navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${body}`); setCopied("Copied."); }
    catch { setCopied("Clipboard unavailable. Select and copy the preview below."); }
  }
  return <main style={{ maxWidth: 1100, margin: "32px auto", padding: 20 }}>
    <h1>{drafts.length} selected companies</h1>
    <p>Manufacturing, distribution, logistics and retail. Selected for practical operating work that Nine-67 can build and help teams adopt.</p>
    <p>Previewing as <strong>{sender}</strong>, using your saved greeting and signature. <a href="/settings">Edit sender settings</a>.</p>
    <p>Each company has its own email and research. Open an email to check the contact address and send from your connected mailbox. Research confirms relevance, not buying intent.</p>
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
        <label>Recipient’s verified name <input readOnly={Boolean(companyDraft.recipientName)} value={name} onChange={(event) => { setNames({ ...names, [selected]: event.target.value }); setCopied(""); }} placeholder="Enter the person you intend to contact" style={{ width: "100%", padding: 12, margin: "8px 0" }} /></label>
        <p><strong>Subject:</strong> {draft.subject}</p>
        <pre style={{ whiteSpace: "pre-wrap", font: "inherit", lineHeight: 1.7, padding: 20, border: "1px solid #d9d3c8" }}>{body}</pre>
        <button type="button" disabled={!name.trim()} onClick={copy}>Copy email</button>{curated && <button type="button" disabled={opening || !companyDraft.recipientName} onClick={openDraft} style={{ marginLeft: 12 }}>{opening ? "Opening…" : "Open email"}</button>} <span role="status">{copied}</span>
        {companyDraft.buyerSourceUrl ? <p><a href={companyDraft.buyerSourceUrl} target="_blank" rel="noreferrer">Verify the intended buyer</a> · Researched September 23, 2026</p> : <p><small>Recipient names entered here last only while this page is open.</small></p>}
        <details><summary>Company source</summary><p>{draft.signal}</p>{/^https?:\/\//i.test(draft.sourceUrl) && <a href={draft.sourceUrl} target="_blank" rel="noreferrer">Review source</a>}</details>
      </section>
    </div>
  </main>;
}
