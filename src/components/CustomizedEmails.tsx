"use client";
import { emailStyle, emailFirstName } from "@/lib/email-style";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Draft = { recipientName?: string; buyerTitle?: string; buyerSourceUrl?: string; id: number; company: string; domain: string; tier: string; subject: string; message: string; sourceUrl: string; signal: string; targetRole?: string; rationale?: string; alternate?: { targetRole: string; subject: string; message: string } };
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
      router.push(`/outreach?card=${result.id}`);
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
  const initials = (value: string) => value.split(/\s+/).slice(0, 2).map(word => word[0]).join("");
  return <main className="deskwork curated-worklist">
    <header className="deskwork-head">
      <div><span className="overview-kick">Your reach-out list</span><h1>Start the right conversation.</h1></div>
      <div className="deskwork-head-right"><span>Nine-67</span><strong>{drafts.length} selected companies</strong><a className="deskwork-overview" href="/settings">Sender settings ↗</a></div>
    </header>
    <div className="deskwork-grid">
      <aside className="deskwork-list" aria-label="Companies">
        <div className="deskwork-list-head"><span>Companies <b>{matches.length}</b></span><span className="deskwork-sort">Selected 25</span></div>
        <input aria-label="Find a company" className="deskwork-search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search companies" />
        <div className="deskwork-list-scroll">
          {matches.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} onClick={() => { setSelected(item.id); setCopied(""); }} className={`deskwork-row ${selected === item.id ? "is-active" : ""}`}>
            <span className="avatar sm">{initials(item.company)}</span><span className="deskwork-row-id"><strong>{item.company}</strong><small>{item.recipientName}</small><small>{item.tier}</small></span>
          </button>)}
          {!matches.length && <p className="deskwork-empty">No companies match your search.</p>}
        </div>
      </aside>
      <section className="deskwork-mid" aria-label="Company research">
        <header className="deskwork-co"><span className="avatar">{initials(draft.company)}</span><div className="deskwork-co-name"><h2>{draft.company}</h2><p>{draft.tier}</p></div></header>
        <div className="deskwork-opening">
          <span className="overview-kick">The opening</span><p className="deskwork-opening-lead">{draft.signal}</p>
          {/^https?:\/\//i.test(draft.sourceUrl) && <a className="focus-link" href={draft.sourceUrl} target="_blank" rel="noreferrer">View company source ↗</a>}
        </div>
        <div className="curated-research-card">
          <span className="overview-kick">Selected contact</span>
          <div className="deskwork-draft-to"><span className="avatar sm">{initials(name)}</span><div><strong>{name || "Choose a recipient"}</strong><small>{draft.buyerTitle || draft.targetRole}</small></div></div>
          {companyDraft.buyerSourceUrl && <a className="focus-link" href={companyDraft.buyerSourceUrl} target="_blank" rel="noreferrer">View buyer source ↗</a>}
        </div>
        {draft.rationale && <details className="curated-research-card"><summary>Why this angle</summary><p>{draft.rationale}</p></details>}
      </section>
      <section className="deskwork-draft" aria-label="Outreach draft">
        <div className="deskwork-draft-top"><span className="overview-kick">Outreach draft</span><span className="deskwork-draft-note">From {sender}</span></div>
        <div className="deskwork-draft-to"><span className="avatar sm">{initials(name)}</span><div><strong>{name || "Recipient"}</strong><small>{draft.buyerTitle || draft.targetRole} · {draft.company}</small></div></div>
        <div className="deskwork-tabs"><span className="deskwork-tab is-active">Email</span><div className="deskwork-tools"><button type="button" disabled={!name.trim()} onClick={copy}>Copy email</button></div></div>
        <div className="deskwork-scroll">
          <div className="curated-email-document">
            {companyDraft.alternate && <label>Buyer version <select value={alternateFor[selected] ? "alternate" : "primary"} onChange={event => { setAlternateFor({ ...alternateFor, [selected]: event.target.value === "alternate" }); setCopied(""); }}><option value="primary">{companyDraft.targetRole}</option><option value="alternate">{companyDraft.alternate.targetRole}</option></select></label>}
            {!companyDraft.recipientName && <label>Recipient’s verified name<input value={name} onChange={event => setNames({ ...names, [selected]: event.target.value })} /></label>}
            <div className="curated-email-subject"><span className="overview-kick">Subject</span><strong>{emailStyle(draft.subject)}</strong></div>
            <div className="curated-email-body">{body}</div>
          </div>
        </div>
        <footer className="deskwork-draft-foot"><span className="deskwork-draft-note">Your saved greeting and signature.<br />Open to edit and check the email address.</span><div className="deskwork-draft-actions">{curated && <button className="btn primary" type="button" disabled={opening || !companyDraft.recipientName} onClick={openDraft}>{opening ? "Opening…" : "Open email →"}</button>}</div>{copied && <p className="curated-copy-status" role="status">{copied}</p>}</footer>
      </section>
    </div>
  </main>;
}
