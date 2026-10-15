"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CallTask } from "@/lib/call-tasks";
import { emailFollowupScripts, type CallBrief } from "@/lib/call-brief";
import { dialHref, formatCallPhone } from "@/lib/call-plan";
import type { CompanyIntel } from "@/lib/call-intel";
import { CallQuestionPills } from "./CallQuestionPills";
import { CallCompanyIntel } from "./CallCompanyIntel";
import { CompanyLogo } from "./CompanyLogo";

type Task = CallTask & { prep: CallBrief; intel: CompanyIntel };
type Draft = { notes: string; outcome: string; reschedule: string };
const outcomes = [["connected", "Connected"], ["voicemail", "Voicemail"], ["no_answer", "No answer"], ["wrong_number", "Wrong number"], ["not_interested", "Not interested"]] as const;
const date = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export function CallQueue({ tasks, canComplete, canEdit, seat, now }: { tasks: Task[]; canComplete: boolean; canEdit: boolean; seat: string; now: number }) {
  const router = useRouter();
  const [view, setView] = useState(tasks.some(task => task.plan.status === "pending" && Date.parse(task.plan.scheduledAt) <= now) ? "due" : "upcoming");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(tasks[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [script, setScript] = useState<"opener" | "gatekeeper" | "voicemail">("opener");
  const open = tasks.filter(task => task.plan.status === "pending" && !finished.has(task.id));
  const due = open.filter(task => Date.parse(task.plan.scheduledAt) <= now);
  const upcoming = open.filter(task => Date.parse(task.plan.scheduledAt) > now);
  const completed = tasks.filter(task => task.plan.status !== "pending");
  const shown = (view === "due" ? due : view === "upcoming" ? upcoming : view === "missing" ? open.filter(task => !task.plan.phone) : completed).filter(task => `${task.name} ${task.company}`.toLowerCase().includes(search.toLowerCase()));
  const task = shown.find(task => task.id === selected) ?? shown[0];
  const draft = task ? drafts[task.id] ?? { notes: task.plan.notes, outcome: "", reschedule: "" } : null;
  const scripts = task ? emailFollowupScripts({ name: task.name, sender: seat, sentAt: task.plan.firstEmailAt, subject: task.emailSubject, bounced: task.bounced }) : null;
  const phone = task?.plan.phone;
  const phoneLabel = phone?.kind === "direct" ? "Direct / extension" : phone?.kind === "contact" ? "Named contact number" : "Office line";

  function editDraft(change: Partial<Draft>) {
    if (!task || !draft) return;
    setDrafts(current => ({ ...current, [task.id]: { ...draft, ...change } }));
  }
  async function save(id: string, body: Record<string, unknown>) {
    setPending(true); setMessage(""); setFailed(false);
    try {
      const response = await fetch(`/api/calls/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result: unknown = await response.json();
      if (!response.ok) throw new Error(typeof result === "object" && result !== null && "error" in result ? String(result.error) : "Could not save call.");
      if (body.action === "complete" || body.action === "skip") {
        const next = shown.find(task => task.id !== id && task.plan.status === "pending");
        setFinished(current => new Set([...current, id]));
        setSelected(next?.id ?? ""); setScript("opener");
        setMessage(next ? "Saved. Next contact ready." : "Saved. You have finished this queue.");
      } else setMessage("Saved.");
      router.refresh();
    } catch (error) {
      setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save call.");
    } finally { setPending(false); }
  }
  return <section className="call-workspace call-cockpit">
    <div className="call-toolbar">
      <div className="review-filters" aria-label="Call queue">{[["due", `Due ${due.length}`], ["upcoming", `Upcoming ${upcoming.length}`], ["missing", `Need a number ${open.filter(task => !task.plan.phone).length}`], ["completed", `Completed ${completed.length}`]].map(([key, label]) => <button type="button" key={key} disabled={pending} className={view === key ? "is-active" : ""} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
      <input aria-label="Search calls" placeholder="Find a contact or company" value={search} disabled={pending} onChange={event => setSearch(event.target.value)} />
    </div>
    {message && <p role={failed ? "alert" : "status"} className={`call-message ${failed ? "is-error" : "is-saved"}`}>{message}</p>}
    <div className="call-columns">
      <aside className="call-list" aria-label="Contacts to call">
        <div className="call-queue-caption">{seat}&rsquo;s contacts <span>{shown.length}</span></div>
        {shown.map(item => <button type="button" key={item.id} disabled={pending} aria-pressed={task?.id === item.id} onClick={() => { setSelected(item.id); setScript("opener"); setMessage(""); }} className={task?.id === item.id ? "is-active" : ""}>
          <CompanyLogo domain={item.domain} name={item.company} size={32} /><span><b>{item.name}</b><span>{item.company}</span><small>{item.plan.phone?.kind === "direct" ? "Direct / extension" : item.plan.phone ? "Number available" : "Number needed"}{drafts[item.id]?.notes !== undefined && drafts[item.id].notes !== item.plan.notes ? " · Draft notes" : ""}</small></span>
        </button>)}
        {!shown.length && <p className="call-empty">No contacts in this view. Try another filter.</p>}
      </aside>
      <div className="call-detail">{task && draft ? <div key={task.id}>
        <header className="call-contact-bar">
          <CompanyLogo domain={task.domain} name={task.company} size={44} />
          <div className="call-contact-title"><span className="overview-kick">{task.company}</span><h2>{task.name}</h2><p>{task.title}</p></div>
          <div className="call-dial-control">{phone ? <><b>{formatCallPhone(phone.number)}</b><small>{phoneLabel}</small>{dialHref(phone.number) && <a className="btn primary" href={dialHref(phone.number)!}>Call now ↗</a>}</> : <b>Not available</b>}</div>
        </header>
        <div className="call-session-meta"><span className={task.bounced ? "call-bounce-badge" : "call-sent-badge"}>{task.bounced ? "Email bounced" : "Email sent"} · {date(task.plan.firstEmailAt)} ET</span><span>Call due {date(task.plan.scheduledAt)} ET</span><Link href={`/brief/${task.cardId}`}>Full brief ↗</Link></div>
        {task.bounced && <p className="call-warning">The email bounced. Confirm their work address before referring to its contents.</p>}
        <div className="call-live-layout">
          <div className="call-conversation">
            <CallQuestionPills key={task.id} questions={task.intel.questionCards} />
            <div className="call-company-snapshot"><CompanyLogo domain={task.domain} name={task.company} size={36} /><div><b>{task.company}</b><p>{task.intel.overview || "Company overview not available."}</p><div className="call-facts">{task.prep.facts.slice(0, 3).map(fact => <span key={fact}>{fact}</span>)}</div></div></div>
            <details className="call-expand-intel"><summary>Company background &amp; full intel <span>Products, customers, systems and signals</span></summary><CallCompanyIntel company={task.company} domain={task.domain} intel={task.intel} facts={task.prep.facts} /></details>
            <section className="call-sent-email call-live-email" aria-label="Sent email for this call">
              <div className="call-section-heading"><span className="overview-kick">Your sent email</span><span>{seat} · {date(task.plan.firstEmailAt)} ET</span></div>
              <h3>{task.emailSubject || "Subject not available"}</h3><p className="call-email-recipient">Contact: {task.name}{task.email ? ` · ${task.email}` : ""}</p>
              <p className="brief-email">{task.emailBody || "Email body not saved. Check Send history before calling."}</p>
              <div className="call-email-foot"><span>{task.bounced ? "Delivery failed" : "Sent; reading is not confirmed"}</span><Link href="/drafts/sent">Send history ↗</Link></div>
            </section>
            <section className="call-script-panel"><div className="call-section-heading"><h3>Start the conversation</h3><span>Use your own words</span></div>
              <div className="call-script-tabs" role="group" aria-label="Call scripts">{([["opener", "Opening"], ["gatekeeper", "Gatekeeper"], ["voicemail", "Voicemail"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={script === key} onClick={() => setScript(key)}>{label}</button>)}</div>
              <p className="call-script-text">{scripts?.[script]}</p>
            </section>

            <details className="call-number-tools"><summary>Phone source &amp; number settings</summary>{phone && <><p>{phone.notes}</p>{phone.sourceUrl && <a href={phone.sourceUrl} target="_blank" rel="noreferrer">View phone source ↗</a>}</>}
              {canEdit && task.plan.status === "pending" && <form className="call-phone-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void save(task.id, { action: "edit", phone: { number: data.get("phone"), kind: data.get("kind"), sourceUrl: data.get("source"), checkedAt: new Date().toISOString(), notes: "Public source reviewed by the operator." } }); }}>
                <label>Number<input name="phone" required defaultValue={phone ? formatCallPhone(phone.number) : ""} /></label><label>Type<select name="kind" defaultValue={phone?.kind ?? "company"}><option value="company">Company office</option><option value="direct">Direct / extension</option><option value="contact">Named contact, type unknown</option></select></label><label>Public source URL<input name="source" type="url" required defaultValue={phone?.sourceUrl ?? ""} /></label><button className="btn-secondary" disabled={pending}>Save number</button>
              </form>}
            </details>
          </div>
          <aside className="call-notepad">{task.plan.status === "pending" && canEdit ? <form className="call-outcome" onSubmit={event => { event.preventDefault(); void save(task.id, { action: "complete", outcome: draft.outcome, notes: draft.notes }); }}>
            <div className="call-section-heading"><h3>Call notes</h3><span>Keep this open</span></div>
            <label className="call-notes-label">What you learn<textarea name="notes" maxLength={3000} value={draft.notes} disabled={pending} onChange={event => editDraft({ notes: event.target.value })} rows={8} placeholder={"Current process / tools\n\nProblem or priority\n\nRight person\n\nAgreed next step + date"} /></label>
            <div className="call-notes-meta"><span>Draft kept while switching contacts</span><button type="button" disabled={pending} onClick={() => void save(task.id, { action: "edit", notes: draft.notes })}>Save notes</button></div>
            <fieldset className="call-outcome-choices" disabled={pending}><legend>Outcome</legend>{outcomes.map(([value, label]) => <label key={value}><input type="radio" name="outcome" value={value} checked={draft.outcome === value} required onChange={() => editDraft({ outcome: value })} /><span>{label}</span></label>)}</fieldset>
            {draft.outcome === "not_interested" && <p className="call-warning">Saving this outcome stops outreach.</p>}
            <button className="btn primary call-save-next" disabled={pending || !canComplete || !phone || !draft.outcome}>{pending ? "Saving…" : "Save & next contact →"}</button>
            <details><summary>Call later instead</summary><label>New time<input type="datetime-local" value={draft.reschedule} disabled={pending} onChange={event => editDraft({ reschedule: event.target.value })} /></label><small>Your browser&rsquo;s local time.</small><button type="button" className="btn-secondary" disabled={pending || !draft.reschedule} onClick={() => void save(task.id, { action: "edit", scheduledAt: new Date(draft.reschedule).toISOString(), notes: draft.notes })}>Save new time</button></details>
            <button type="button" className="call-skip" disabled={pending} onClick={() => void save(task.id, { action: "skip", notes: draft.notes })}>Skip this contact</button><small className="muted">Logs notes and outcomes. Audio recording is not connected.</small>
          </form> : <div className="call-completed-note"><h3>Call outcome</h3><p>{task.plan.outcome?.replaceAll("_", " ") ?? task.plan.status}</p><p className="brief-email">{task.plan.notes || "Not available"}</p></div>}</aside>
        </div>
      </div> : <div className="call-queue-done"><h2>{tasks.length ? "You’re caught up in this view." : "Your call queue starts with a sent email."}</h2><p>Choose another queue or search for a contact to continue.</p></div>}</div>
    </div>
  </section>;
}
