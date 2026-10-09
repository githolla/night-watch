"use client";

import Link from "next/link";
import { useState } from "react";

export type DraftSample = { first: string; company: string; subject: string };
type Fault = { rule: string; says: string; blocking: boolean };
type Problem = { id: string; who: string; company: string; faults: Fault[] };
type Audit = { checked: number; clean: number; problems: Problem[] };

const fill = (text: string, sample: DraftSample) => text.replace(/\{first\}/gi, sample.first).replace(/\{company\}/gi, sample.company);

/**
 * The three things a person does to all their drafts, in plain words: how each email starts, the subject,
 * and a check for problems. Each shows real examples before anything changes and says what happened after.
 */
export function DraftSetup({ owner, unsent, samples, listHref }: { owner: string; unsent: number; samples: DraftSample[]; listHref: string }) {
  const [greeting, setGreeting] = useState("Hi {first},");
  const [subject, setSubject] = useState("");
  const [busy, setBusy] = useState<"" | "greeting" | "subject" | "check" | "tidy">("");
  // Fixing one flagged email right in the list: the open one, its text and saved version, and what happened.
  const [fixing, setFixing] = useState<{ id: string; subject: string; body: string; updatedAt: string } | null>(null);
  const [fixBusy, setFixBusy] = useState(false);
  const [fixNote, setFixNote] = useState<{ id: string; text: string; ok: boolean; conflict?: boolean } | null>(null);
  const [fixed, setFixed] = useState<string[]>([]);
  const [done, setDone] = useState<{ greeting?: string; subject?: string; check?: string }>({});
  const [audit, setAudit] = useState<Audit | null>(null);

  // The bulk routes work through the drafts in batches; keep calling until none remain.
  async function drain(url: string, body: Record<string, unknown>, key: "applied") {
    const before = new Date().toISOString();
    let total = 0;
    for (let i = 0; i < 200; i++) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, listOnly: true, ...body, before }) });
      const json = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(String(json.error ?? "Something went wrong. Nothing else was changed."));
      total += Number(json[key] ?? json.applied ?? 0);
      if (!Number(json.remaining)) break;
    }
    return total;
  }

  async function applyGreeting() {
    if (!greeting.trim() || !window.confirm(`Change how all ${unsent} of your unsent emails start?\n\nFor example: "${fill(greeting, samples[0] ?? { first: "Dana", company: "Acme", subject: "" })}"`)) return;
    setBusy("greeting");
    try { const count = await drain("/api/admin/apply-greeting", { greeting }, "applied"); setDone((d) => ({ ...d, greeting: `Done. ${count} email${count === 1 ? "" : "s"} now start this way.` })); }
    catch (error) { setDone((d) => ({ ...d, greeting: error instanceof Error ? error.message : "Something went wrong." })); }
    finally { setBusy(""); }
  }

  async function applySubject() {
    if (!subject.trim() || !window.confirm(`Use this subject on all ${unsent} of your unsent emails?\n\nFor example: "${fill(subject, samples[0] ?? { first: "Dana", company: "Acme", subject: "" })}"`)) return;
    setBusy("subject");
    try { const count = await drain("/api/admin/apply-subject", { subject }, "applied"); setDone((d) => ({ ...d, subject: `Done. ${count} email${count === 1 ? "" : "s"} have the new subject.` })); }
    catch (error) { setDone((d) => ({ ...d, subject: error instanceof Error ? error.message : "Something went wrong." })); }
    finally { setBusy(""); }
  }

  async function check() {
    setBusy("check"); setAudit(null); setFixed([]); setFixing(null); setFixNote(null); setDone((d) => ({ ...d, check: undefined }));
    try {
      const totals: Audit = { checked: 0, clean: 0, problems: [] };
      for (let offset = 0, i = 0; i < 100; i++) {
        const response = await fetch("/api/admin/audit-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, listOnly: true, offset }) });
        const json = await response.json().catch(() => ({})) as { checked?: number; clean?: number; problems?: Problem[]; next?: number; done?: boolean; error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not check your emails.");
        totals.checked += json.checked ?? 0; totals.clean += json.clean ?? 0; totals.problems.push(...(json.problems ?? []));
        if (json.done || json.next === undefined) break;
        offset = json.next;
      }
      setAudit(totals);
    } catch (error) { setDone((d) => ({ ...d, check: error instanceof Error ? error.message : "Could not check your emails." })); }
    finally { setBusy(""); }
  }

  async function openFix(problem: Problem) {
    setFixNote(null);
    setFixBusy(true);
    try {
      const response = await fetch(`/api/cards/${problem.id}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as { email_subject?: string | null; email_body?: string | null; updated_at?: string; error?: string };
      if (!response.ok || !json.updated_at) { setFixNote({ id: problem.id, text: json.error ?? "Could not open this email.", ok: false }); return; }
      setFixing({ id: problem.id, subject: json.email_subject ?? "", body: json.email_body ?? "", updatedAt: json.updated_at });
    } catch { setFixNote({ id: problem.id, text: "Could not open this email: the connection dropped.", ok: false }); }
    finally { setFixBusy(false); }
  }

  /** Save through the desk's own route (with its version check), then check just this email again. */
  async function saveFix() {
    if (!fixing) return;
    if (!fixing.subject.trim() || !fixing.body.trim()) { setFixNote({ id: fixing.id, text: "An email needs a subject and a message.", ok: false }); return; }
    setFixBusy(true);
    try {
      const response = await fetch(`/api/cards/${fixing.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email_subject: fixing.subject, email_body: fixing.body, expected_updated_at: fixing.updatedAt }) });
      const json = await response.json().catch(() => ({})) as { updated_at?: string; email_subject?: string; email_body?: string; error?: string };
      if (!response.ok) {
        setFixNote({ id: fixing.id, text: response.status === 409 ? "Not saved: this email was changed somewhere else (or sent) since you opened it. Your text is still here." : json.error ?? "Not saved. Try again.", ok: false, conflict: response.status === 409 });
        return;
      }
      const saved = { ...fixing, subject: json.email_subject ?? fixing.subject, body: json.email_body ?? fixing.body, updatedAt: json.updated_at ?? fixing.updatedAt };
      const recheck = await fetch("/api/admin/audit-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, listOnly: true, ids: [saved.id] }) });
      const result = await recheck.json().catch(() => ({})) as { problems?: Problem[] };
      const still = recheck.ok ? result.problems?.find((problem) => problem.id === saved.id) : undefined;
      if (recheck.ok && !still) {
        setFixed((current) => [...current, saved.id]);
        setFixing(null);
        setFixNote({ id: saved.id, text: "Saved. This email looks good now.", ok: true });
        return;
      }
      setFixing(saved);
      if (still) setAudit((current) => current && { ...current, problems: current.problems.map((problem) => problem.id === saved.id ? still : problem) });
      setFixNote({ id: saved.id, text: still ? `Saved, but it still needs a look: ${still.faults.map((fault) => fault.says).join("; ")}` : "Saved.", ok: !still });
    } catch { setFixNote({ id: fixing.id, text: "Not saved: the connection dropped. Your text is still here.", ok: false }); }
    finally { setFixBusy(false); }
  }

  async function loadSavedFix() {
    if (!fixing) return;
    const id = fixing.id;
    const response = await fetch(`/api/cards/${id}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({})) as { email_subject?: string | null; email_body?: string | null; updated_at?: string; status?: string };
    if (!response.ok || !json.updated_at) { setFixNote({ id, text: "Could not load the saved version.", ok: false, conflict: true }); return; }
    if (json.status && !["new", "edited", "approved"].includes(json.status)) { setFixing(null); setFixed((current) => [...current, id]); setFixNote({ id, text: "That email has already been sent.", ok: true }); return; }
    setFixing({ id, subject: json.email_subject ?? "", body: json.email_body ?? "", updatedAt: json.updated_at });
    setFixNote({ id, text: "Showing the saved version. Edit it and save again if you like.", ok: true });
  }

  async function tidy() {
    setBusy("tidy");
    try {
      let fixed = 0;
      for (let offset = 0, i = 0; i < 100; i++) {
        const response = await fetch("/api/admin/clean-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, listOnly: true, offset }) });
        const json = await response.json().catch(() => ({})) as { cleaned?: number; offset?: number; done?: boolean; error?: string };
        if (!response.ok) throw new Error(json.error ?? "Could not tidy your emails.");
        fixed += json.cleaned ?? 0;
        if (json.done || json.offset === undefined) break;
        offset = json.offset;
      }
      setDone((d) => ({ ...d, check: `Tidied ${fixed} email${fixed === 1 ? "" : "s"}. Checking again…` }));
      await check();
    } catch (error) { setDone((d) => ({ ...d, check: error instanceof Error ? error.message : "Something went wrong." })); }
    finally { setBusy(""); }
  }

  const examples = samples.slice(0, 2);
  return (
    <div className="draft-setup">
      <section className="setup-card">
        <div className="setup-step">1</div>
        <div className="setup-body">
          <h2>How every email starts</h2>
          <p>Type the greeting once. <code>{"{first}"}</code> becomes each person&rsquo;s first name.</p>
          <input className="setup-input" value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder="Hi {first}," aria-label="Greeting" />
          {greeting.trim() && examples.length > 0 && <ul className="setup-examples">{examples.map((sample) => <li key={sample.company}>{fill(greeting, sample)} <span>({sample.company})</span></li>)}</ul>}
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !greeting.trim() || !unsent} onClick={applyGreeting}>{busy === "greeting" ? "Updating…" : `Use on all ${unsent} emails`}</button>
            {done.greeting && <span className="setup-done" role="status">{done.greeting}</span>}
          </div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">2</div>
        <div className="setup-body">
          <h2>Subject line for every email</h2>
          <p>Type one subject. <code>{"{company}"}</code> becomes each company&rsquo;s name. Leave this alone to keep each email&rsquo;s own subject.</p>
          <input className="setup-input" value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} placeholder="An idea for {company}" aria-label="Subject" />
          {subject.trim() && examples.length > 0 && <ul className="setup-examples">{examples.map((sample) => <li key={sample.company}>{fill(subject, sample)}</li>)}</ul>}
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !subject.trim() || !unsent} onClick={applySubject}>{busy === "subject" ? "Updating…" : `Use on all ${unsent} emails`}</button>
            {done.subject && <span className="setup-done" role="status">{done.subject}</span>}
          </div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">3</div>
        <div className="setup-body">
          <h2>The message itself</h2>
          <p>Open any email on the <Link href={listHref}>Reach-out list</Link>, write the message the way you want it, then press <b>Apply message to batch</b>. Every other email gets the same message with its own name and company.</p>
          <div className="setup-actions"><Link className="btn" href={listHref}>Open the Reach-out list</Link></div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">4</div>
        <div className="setup-body">
          <h2>Check my emails for problems</h2>
          <p>Looks through every unsent email for things like a missing subject, the wrong name, or a leftover placeholder. Nothing is changed or sent.</p>
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !unsent} onClick={check}>{busy === "check" ? "Checking…" : "Check my emails"}</button>
            {done.check && <span className="setup-done" role="status">{done.check}</span>}
          </div>
          {audit && (audit.problems.length === 0
            ? <p className="setup-good" role="status">All {audit.checked} emails look good.</p>
            : <div className="setup-problems" role="status">
                <p><b>{audit.problems.length - fixed.length} of {audit.checked} emails need a look.</b> Press <b>Fix</b> to change one right here, or let Night Watch tidy the simple ones.</p>
                <ul className="setup-fix-list">{audit.problems.map((problem) => {
                  const done = fixed.includes(problem.id);
                  const open = fixing?.id === problem.id;
                  const note = fixNote?.id === problem.id ? fixNote : null;
                  return (
                    <li key={problem.id} className={`setup-fix ${done ? "is-fixed" : ""} ${open ? "is-open" : ""}`}>
                      <div className="setup-fix-row">
                        <span><b>{problem.who}</b>, {problem.company}{done ? "" : <>: <span className="setup-fault">{problem.faults.map((fault) => fault.says).join("; ")}</span></>}</span>
                        {done ? <span className="setup-fixed">Fixed</span> : !open && <button type="button" className="btn" disabled={fixBusy} onClick={() => void openFix(problem)}>Fix</button>}
                      </div>
                      {open && fixing && (
                        <div className="setup-fix-editor">
                          <label><span>Subject</span><input value={fixing.subject} maxLength={120} aria-label="Fix subject" onChange={(event) => setFixing({ ...fixing, subject: event.target.value })} /></label>
                          <label><span>Message</span><textarea rows={9} maxLength={1000} value={fixing.body} aria-label="Fix message" onChange={(event) => setFixing({ ...fixing, body: event.target.value })} /></label>
                          <div className="setup-actions">
                            <button type="button" className="btn primary" disabled={fixBusy} onClick={() => void saveFix()}>{fixBusy ? "Saving…" : "Save and check again"}</button>
                            <button type="button" className="btn ghost" disabled={fixBusy} onClick={() => { setFixing(null); setFixNote(null); }}>Cancel</button>
                            <Link className="review-open" href={`${listHref}&card=${problem.id}`}>Open on the Reach-out list &rarr;</Link>
                            {note?.conflict && <button type="button" className="btn" onClick={() => void loadSavedFix()}>Load the saved version</button>}
                          </div>
                        </div>
                      )}
                      {note && <p className={`setup-fix-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</p>}
                    </li>
                  );
                })}</ul>
                <button type="button" className="btn" disabled={!!busy} onClick={tidy}>{busy === "tidy" ? "Tidying…" : "Tidy the simple ones for me"}</button>
              </div>)}
        </div>
      </section>
    </div>
  );
}
