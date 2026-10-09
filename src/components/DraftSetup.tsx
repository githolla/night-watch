"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReviewSender } from "@/components/DraftReview";
import type { CurrentTemplates } from "@/lib/draft-templates";
import { outreachEmailHtml } from "@/lib/outreach-ending";

export type DraftSample = { first: string; company: string; subject: string };
type Fault = { rule: string; says: string; blocking: boolean };
type Problem = { id: string; who: string; company: string; faults: Fault[] };
type Audit = { checked: number; clean: number; problems: Problem[] };

const fill = (text: string, sample: DraftSample) => text.replace(/\{first\}/gi, sample.first).replace(/\{company\}/gi, sample.company);
const GREETINGS = ["Hi {first},", "Hello {first},", "{first},", "Good morning {first},", "Dear {first},"];
const SUBJECTS = ["An idea for {company}", "Quick idea for {company}", "{first}, an idea for {company}", "A question about {company}", "{company} and Nine-67"];
const MIDDLE = "@@MIDDLE@@";
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// What someone typed but has not applied yet survives leaving the page, per seat. Storage can be blocked.
const stored = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string | null) => { try { if (value === null) window.localStorage.removeItem(key); else window.localStorage.setItem(key, value); } catch { /* storage blocked */ } };

/**
 * The three things a person does to all their drafts, in plain words: how each email starts, the subject,
 * and a check for problems. Each shows real examples before anything changes and says what happened after.
 */
export function DraftSetup({ owner, unsent, samples, listHref, current, sender, optOut }: { owner: string; unsent: number; samples: DraftSample[]; listHref: string; current: CurrentTemplates; sender: ReviewSender; optOut: string }) {
  const router = useRouter();
  // The boxes open on what the drafts really use now; an unapplied edit from before comes back on top of it.
  const [greeting, setGreetingState] = useState(current.greeting ?? "Hi {first},");
  const [subject, setSubjectState] = useState(current.subject ?? "");
  const greetingKey = `nw-draft-greeting-${owner}`, subjectKey = `nw-draft-subject-${owner}`;
  useEffect(() => {
    const g = stored(greetingKey), sub = stored(subjectKey);
    if (g !== null) setGreetingState(g);
    if (sub !== null) setSubjectState(sub);
  }, [greetingKey, subjectKey]);
  const setGreeting = (value: string) => { setGreetingState(value); store(greetingKey, value === (current.greeting ?? "Hi {first},") ? null : value); };
  const setSubject = (value: string) => { setSubjectState(value); store(subjectKey, value === (current.subject ?? "") ? null : value); };
  const greetingPending = greeting.trim() !== "" && greeting !== current.greeting;
  const subjectPending = subject.trim() !== "" && subject !== current.subject;
  const [busy, setBusy] = useState<"" | "greeting" | "subject" | "check">("");
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
    try { const count = await drain("/api/admin/apply-greeting", { greeting }, "applied"); setDone((d) => ({ ...d, greeting: `Saved. ${count} email${count === 1 ? "" : "s"} now start this way.` })); store(greetingKey, null); router.refresh(); }
    catch (error) { setDone((d) => ({ ...d, greeting: error instanceof Error ? error.message : "Something went wrong." })); }
    finally { setBusy(""); }
  }

  async function applySubject() {
    if (!subject.trim() || !window.confirm(`Use this subject on all ${unsent} of your unsent emails?\n\nFor example: "${fill(subject, samples[0] ?? { first: "Dana", company: "Acme", subject: "" })}"`)) return;
    setBusy("subject");
    try { const count = await drain("/api/admin/apply-subject", { subject }, "applied"); setDone((d) => ({ ...d, subject: `Saved. ${count} email${count === 1 ? "" : "s"} have the new subject.` })); store(subjectKey, null); router.refresh(); }
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

  /** The simple repairs sending would make anyway (a repeated paragraph, an extra link to our site), saved first. */
  async function tidyAll() {
    let fixedCount = 0;
    for (let offset = 0, i = 0; i < 100; i++) {
      const response = await fetch("/api/admin/clean-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, listOnly: true, offset }) });
      const json = await response.json().catch(() => ({})) as { cleaned?: number; offset?: number; done?: boolean; error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not tidy your emails.");
      fixedCount += json.cleaned ?? 0;
      if (json.done || json.offset === undefined) break;
      offset = json.offset;
    }
    return fixedCount;
  }

  /** Fix what can be fixed without a person, then show only what is left. */
  async function checkAndTidy() {
    setBusy("check");
    try {
      const tidied = await tidyAll();
      await check();
      if (tidied) setDone((d) => ({ ...d, check: `Fixed ${tidied} simple thing${tidied === 1 ? "" : "s"} for you (repeated paragraphs, extra links to our site).` }));
    } catch (error) { setDone((d) => ({ ...d, check: error instanceof Error ? error.message : "Could not check your emails." })); setBusy(""); }
  }

  const mustFix = audit?.problems.filter((problem) => problem.faults.some((fault) => fault.blocking)) ?? [];
  const optional = audit?.problems.filter((problem) => !problem.faults.some((fault) => fault.blocking)) ?? [];
  const problemItem = (problem: Problem) => {
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
  };
  const examples = samples.slice(0, 2);
  const sample = samples[0] ?? null;
  // The real ending (signature, postal address, opt-out line) around a marked middle, exactly as sending builds it.
  const opening = greeting.trim() ? fill(greeting, sample ?? { first: "Dana", company: "Acme", subject: "" }) : "Hi Dana,";
  const previewHtml = `${outreachEmailHtml(`${opening}\n\n${MIDDLE}`, sender).replace(MIDDLE, '<span class="setup-preview-middle">The middle is written for each company: what caught our eye, one idea for them, and a question to reply to.</span>')}<p style="font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b645a">${escapeHtml(optOut)}</p>`;
  return (
    <div className="draft-setup">
      <section className="setup-card">
        <div className="setup-step">1</div>
        <div className="setup-body">
          <h2>How every email starts</h2>
          <p>Type the greeting once, or pick one below. <code>{"{first}"}</code> becomes each person&rsquo;s first name.</p>
          <p className="setup-current">{current.greeting ? <>In use now: <b>{current.greeting}</b></> : "Your emails start in different ways right now."}</p>
          <input className="setup-input" value={greeting} onChange={(event) => setGreeting(event.target.value)} placeholder="Hi {first}," aria-label="Greeting" />
          <div className="setup-suggest" aria-label="Greeting ideas">{GREETINGS.map((idea) => <button key={idea} type="button" className={`setup-chip ${greeting === idea ? "is-active" : ""}`} onClick={() => setGreeting(idea)}>{idea}</button>)}</div>
          {greeting.trim() && examples.length > 0 && <ul className="setup-examples">{examples.map((sample) => <li key={sample.company}>{fill(greeting, sample)} <span>({sample.company})</span></li>)}</ul>}
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !greeting.trim() || !unsent || !greetingPending} onClick={applyGreeting}>{busy === "greeting" ? "Saving…" : greetingPending ? `Save on all ${unsent} emails` : "Saved"}</button>
            {greetingPending && !busy && <span className="setup-pending">Not saved yet</span>}
            {done.greeting && <span className="setup-done" role="status">{done.greeting}</span>}
          </div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">2</div>
        <div className="setup-body">
          <h2>Subject line for every email</h2>
          <p>Type one subject, or pick one below. <code>{"{company}"}</code> becomes each company&rsquo;s name and <code>{"{first}"}</code> the person&rsquo;s first name.</p>
          <p className="setup-current">{current.subject ? <>In use now: <b>{current.subject}</b></> : current.subjectExample ? <>Each email has its own subject now, for example <b>{current.subjectExample}</b>. Leave this empty to keep them.</> : "No subjects yet."}</p>
          <input className="setup-input" value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} placeholder="An idea for {company}" aria-label="Subject" />
          <div className="setup-suggest" aria-label="Subject ideas">{SUBJECTS.map((idea) => <button key={idea} type="button" className={`setup-chip ${subject === idea ? "is-active" : ""}`} onClick={() => setSubject(idea)}>{idea}</button>)}</div>
          {subject.trim() && examples.length > 0 && <ul className="setup-examples">{examples.map((sample) => <li key={sample.company}>{fill(subject, sample)}</li>)}</ul>}
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !subject.trim() || !unsent || !subjectPending} onClick={applySubject}>{busy === "subject" ? "Saving…" : subjectPending || !subject.trim() ? `Save on all ${unsent} emails` : "Saved"}</button>
            {subjectPending && !busy && <span className="setup-pending">Not saved yet</span>}
            {done.subject && <span className="setup-done" role="status">{done.subject}</span>}
          </div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">3</div>
        <div className="setup-body">
          <h2>The message itself</h2>
          <p>This is how every email looks. The start and the ending are the same on all of them; the middle is written for each company. To change the middle for everyone, open any email on the <Link href={listHref}>Reach-out list</Link>, write it the way you want, then press <b>Apply message to batch</b>.</p>
          <div className="setup-preview" aria-label="How every email looks">
            <p className="setup-preview-meta"><span>From</span> {sender.fromName}</p>
            <p className="setup-preview-meta"><span>Subject</span> {subject.trim() && sample ? fill(subject, sample) : sample?.subject || "Each email's own subject"}</p>
            <div className="setup-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          <div className="setup-actions"><Link className="btn" href={listHref}>Open the Reach-out list</Link></div>
        </div>
      </section>

      <section className="setup-card">
        <div className="setup-step">4</div>
        <div className="setup-body">
          <h2>Check my emails for problems</h2>
          <p>Looks through every unsent email. Simple things (a repeated paragraph, an extra link to our site) are fixed for you; anything that needs a person is listed with a <b>Fix</b> button. Nothing is sent.</p>
          <div className="setup-actions">
            <button type="button" className="btn primary" disabled={!!busy || !unsent} onClick={() => void checkAndTidy()}>{busy === "check" ? "Checking…" : "Check my emails"}</button>
            {done.check && <span className="setup-done" role="status">{done.check}</span>}
          </div>
          {audit && (audit.problems.length === 0
            ? <p className="setup-good" role="status">All {audit.checked} emails look good.</p>
            : <div className="setup-problems" role="status">
                {mustFix.length > 0
                  ? <p><b>{mustFix.length - mustFix.filter((problem) => fixed.includes(problem.id)).length} of {audit.checked} emails need fixing before they can go.</b> Press <b>Fix</b> to change one right here.</p>
                  : <p><b>Nothing needs fixing.</b> All {audit.checked} emails can go out.</p>}
                {mustFix.length > 0 && <ul className="setup-fix-list">{mustFix.map(problemItem)}</ul>}
                {optional.length > 0 && (
                  <details className="setup-optional">
                    <summary>{optional.length} optional suggestion{optional.length === 1 ? "" : "s"} (fine to send as they are)</summary>
                    <ul className="setup-fix-list">{optional.map(problemItem)}</ul>
                  </details>
                )}
              </div>)}
        </div>
      </section>
    </div>
  );
}
