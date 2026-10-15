"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CallTask } from "@/lib/call-tasks";
import type { CallBrief } from "@/lib/call-brief";
import { emailFollowupScripts } from "@/lib/call-brief";
import { dialHref } from "@/lib/call-plan";
import { CompanyLogo } from "./CompanyLogo";

type Task = CallTask & { prep: CallBrief };
const date = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });
export function CallQueue({ tasks, canComplete, canEdit, seat, now }: { tasks: Task[]; canComplete: boolean; canEdit: boolean; seat: string; now: number }) {
  const router = useRouter();
  const [view, setView] = useState(tasks.some(task => task.plan.status === "pending" && Date.parse(task.plan.scheduledAt) <= now) ? "due" : "upcoming");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(tasks.find(t => t.plan.status === "pending")?.id ?? tasks[0]?.id);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [script, setScript] = useState<"opener" | "gatekeeper" | "voicemail">("opener");
  const open = tasks.filter(t => t.plan.status === "pending");
  const due = open.filter(t => Date.parse(t.plan.scheduledAt) <= now);
  const upcoming = open.filter(t => Date.parse(t.plan.scheduledAt) > now);
  const completed = tasks.filter(t => t.plan.status !== "pending");
  const shown = (view === "due" ? due : view === "upcoming" ? upcoming : view === "missing" ? open.filter(t => !t.plan.phone) : completed).filter(t => `${t.name} ${t.company}`.toLowerCase().includes(search.toLowerCase()));
  const task = tasks.find(t => t.id === selected && shown.some(row => row.id === t.id)) ?? shown[0];
  const scripts = task ? emailFollowupScripts({ name: task.name, sender: seat, sentAt: task.plan.firstEmailAt, subject: task.emailSubject, bounced: task.bounced }) : null;
  async function save(id: string, body: Record<string, unknown>) {
    setPending(true); setMessage("");
    try { const response = await fetch(`/api/calls/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || "Could not save call."); setMessage(body.action === "complete" ? "Call outcome saved. Open the next contact when ready." : "Saved."); router.refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save call."); }
    finally { setPending(false); }
  }
  return <section className="call-workspace">
    <div className="call-summary"><div><strong>{due.length}</strong><span>Due now</span></div><div><strong>{upcoming.length}</strong><span>Coming up</span></div><div><strong>{open.filter(t => t.plan.phone).length}</strong><span>With a number</span></div><div><strong>{open.filter(t => !t.plan.phone).length}</strong><span>Need a number</span></div></div>
    <div className="call-toolbar"><div className="review-filters" aria-label="Call queue">{[["due", `Due (${due.length})`], ["upcoming", `Upcoming (${upcoming.length})`], ["missing", "Need a number"], ["completed", "Completed"]].map(([key, label]) => <button type="button" key={key} className={view === key ? "is-active" : ""} onClick={() => setView(key)}>{label}</button>)}</div><input aria-label="Search calls" placeholder="Find a person or company" value={search} onChange={e => setSearch(e.target.value)} /></div>
    {message && <p role="status" className="call-message">{message}</p>}
    <div className="call-columns"><div className="call-list">{shown.length ? shown.map(t => <button type="button" key={t.id} disabled={pending} onClick={() => { setSelected(t.id); setScript("opener"); setMessage(""); }} className={task?.id === t.id ? "is-active" : ""}><CompanyLogo domain={t.domain} name={t.company} size={36} /><span><b>{t.name}</b><span>{t.company}</span><small>{date(t.plan.scheduledAt)} ET · {t.plan.phone ? t.plan.phone.kind === "company" ? "Office line" : t.plan.phone.kind === "direct" ? "Direct / extension" : "Named contact" : "Number needed"}</small></span></button>) : <p className="call-empty">{tasks.length ? "No calls in this view. Check Upcoming or Need a number." : "Calls appear after your first email sends. Emails with a reply or opt-out do not become cold-call tasks."}</p>}</div>
    <div className="call-detail">{task ? <div key={task.id}>
      <header className="call-prep-head"><CompanyLogo domain={task.domain} name={task.company} size={48} /><div><span className="overview-kick">{seat}&rsquo;s call prep</span><h2>{task.name}</h2><p className="muted">{task.title} · {task.company}</p></div><Link className="btn-secondary" href={`/brief/${task.cardId}`}>Full brief ↗</Link></header>
      <nav className="call-prep-steps" aria-label="Call workflow"><a href="#call-context">1. Review the prep</a><a href="#call-script">2. Make the call</a><a href="#call-result">3. Save the outcome</a></nav>
      <p><b>{date(task.plan.scheduledAt)} ET</b> · First email {date(task.plan.firstEmailAt)} ET</p>
      {task.bounced && <p className="call-warning">The first email bounced. Confirm the contact and email address on the call; do not assume they received it.</p>}
      <div className="call-phone">{task.plan.phone ? <><b>{task.plan.phone.number}</b><span>{task.plan.phone.kind === "company" ? "Company main line: ask for this person" : task.plan.phone.kind === "direct" ? "Direct line from the saved source" : "Contact number: direct-line status not recorded"}</span><p className="call-phone-notes">{task.plan.phone.notes}</p>{task.plan.phone.sourceUrl && <a href={task.plan.phone.sourceUrl} target="_blank" rel="noreferrer">Phone source ↗</a>}{dialHref(task.plan.phone.number) && <a className="btn primary" href={dialHref(task.plan.phone.number)!}>Call {task.plan.phone.number}</a>}</> : <><b>No phone number on file</b><span>Night Watch searches the company&rsquo;s public contact pages. Add a sourced number below when needed.</span></>}</div>
      {canEdit && task.plan.status === "pending" && <details className="call-edit"><summary>Add or update a number</summary><form onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save(task.id, { action: "edit", phone: { number: data.get("phone"), kind: data.get("kind"), sourceUrl: data.get("source"), checkedAt: new Date().toISOString(), notes: "Public source reviewed by the operator." } }); }}><label>Phone number<input name="phone" required defaultValue={task.plan.phone?.number ?? ""} placeholder="+1 555 123 4567" /></label><label>Number type<select name="kind" defaultValue={task.plan.phone?.kind ?? "company"}><option value="company">Company main line</option><option value="direct">Direct line</option><option value="contact">Contact number, type unknown</option></select></label><label>Source URL<input type="url" name="source" required defaultValue={task.plan.phone?.sourceUrl ?? ""} placeholder="https://company.com/contact" /></label><button className="btn" disabled={pending}>Save number</button></form></details>}
      <div className="call-context-grid" id="call-context">
      <section className="call-sent-email" aria-label="Sent email for this call">
        <span className="overview-kick">{task.bounced ? "Email attempted · bounced" : "Email sent · follow up on this"}</span>
        <h3>{task.emailSubject || "Subject not recorded"}</h3>
        <p><b>Sent by {seat}:</b> <time dateTime={task.plan.firstEmailAt}>{date(task.plan.firstEmailAt)} Eastern</time></p>
        <p><b>Contact:</b> {task.name}{task.email ? ` · ${task.email}` : ""}</p>
        <p className="muted">{task.bounced ? "They did not receive this email. Confirm the address before referring to its contents." : "Recorded as sent. No substantive reply recorded; delivery and reading are not confirmed. Use this email as the context for your call."}</p>
        <p className="brief-email">{task.emailBody || "Email body not saved. Review Send history before calling."}</p>
        <Link href="/drafts/sent">Open Send history ↗</Link>
      </section>
      <section className="call-intel"><span className="overview-kick">Company background &amp; intel</span><h3>{task.company}</h3>
        <a href={`https://${task.domain}`} target="_blank" rel="noreferrer">{task.domain} ↗</a>
        {task.prep.facts.length > 0 && <div className="call-facts">{task.prep.facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
        <h4>Why we reached out</h4>{task.prep.why.length ? <ul>{task.prep.why.map((why, i) => <li key={i}>{why.text}{why.url && <> <a href={why.url} target="_blank" rel="noreferrer">Source ↗</a></>}</li>)}</ul> : <p>{task.why || "Company background has not been recorded. Review the email for context."}</p>}
        <h4>Workflow to explore</h4><p>{task.prep.workflow || "Ask which recurring task creates the most manual work for their team."}</p>
        <details><summary>What still needs confirming</summary><ul>{task.prep.unknowns.map(item => <li key={item}>{item}</li>)}</ul></details>
      </section></div>
      <section className="call-script-panel" id="call-script"><span className="overview-kick">During the call</span><h3>Pick up the email conversation</h3>
        <div className="call-script-tabs" role="group" aria-label="Call scripts">{([["opener", "Opening"], ["gatekeeper", "Someone else answers"], ["voicemail", "Voicemail"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={script === key} onClick={() => setScript(key)}>{label}</button>)}</div>
        <p className="call-script-text">{scripts?.[script]}</p><p className="muted">{task.bounced ? "Confirm the right work email first. Then ask permission to share the idea." : "If they read it, ask what stood out. If they have not, give the quick version from the email above."}</p>
      </section>
      <section className="call-discovery"><h3>Learn enough to agree on a next step</h3><ol>{task.prep.discovery.slice(0, 4).map(question => <li key={question}>{question}</li>)}</ol><p><b>Goal:</b> Agree on one workflow to explore and a next step with a date.</p></section>
      <p><Link href={`/brief/${task.cardId}`}>Full company and contact brief ↗</Link></p>
      {task.plan.status === "pending" && canEdit ? <form id="call-result" className="call-outcome" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); void save(task.id, { action: "complete", outcome: data.get("outcome"), notes: data.get("notes") }); }}><div><span className="overview-kick">After the call</span><h3>Save the outcome and next step</h3><p className="muted">Capture what you learned before opening the next contact.</p></div><label>Outcome<select name="outcome"><option value="connected">Connected</option><option value="voicemail">Left voicemail</option><option value="no_answer">No answer</option><option value="wrong_number">Wrong number</option><option value="not_interested">Not interested, stop outreach</option></select></label><label>Notes and next step<textarea name="notes" maxLength={3000} defaultValue={task.plan.notes} rows={3} placeholder="What did they say? Who owns the workflow? Agreed next step and date?" /></label><div className="call-actions"><button className="btn primary" disabled={pending || !canComplete || !task.plan.phone}>Save call outcome</button><button type="button" className="btn" disabled={pending} onClick={() => { const form = document.querySelector<HTMLFormElement>(".call-outcome"); const data = form ? new FormData(form) : null; void save(task.id, { action: "skip", notes: data?.get("notes") ?? "" }); }}>Skip</button><button type="button" className="btn" disabled={pending} onClick={() => { const form = document.querySelector<HTMLFormElement>(".call-outcome"); const data = form ? new FormData(form) : null; void save(task.id, { action: "edit", notes: data?.get("notes") ?? "" }); }}>Save notes</button></div><label>Reschedule<input type="datetime-local" aria-label="New call time in your browser's local timezone" onChange={e => { if (e.target.value) void save(task.id, { action: "edit", scheduledAt: new Date(e.target.value).toISOString() }); }} /></label><small className="muted">Save call outcome logs your notes; it does not record audio. Reschedule uses your browser&rsquo;s local time.</small></form> : <p id="call-result"><b>{task.plan.outcome?.replaceAll("_", " ") ?? task.plan.status}</b>{task.plan.notes && <span> · {task.plan.notes}</span>}</p>}
    </div> : <p className="call-empty">Select a call to see its prep.</p>}</div></div>
  </section>;
}
