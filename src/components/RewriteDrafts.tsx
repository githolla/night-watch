"use client";

import { useEffect, useState } from "react";

const GREETING_KEY = "nw.blanketGreeting";

type Fault = { rule: string; says: string; blocking: boolean };
type Problem = { id: string; who: string; company: string; status: string; subject: string; faults: Fault[] };
type AuditResult = { checked: number; clean: number; unsendable: number; byRule: Record<string, number>; problems: Problem[] };

type Preview = { total: number; scanned: number; wouldChange: number; exact: boolean; samples: Array<{ name: string; before: string; after: string }> };

/**
 * Three separate things you can do to every un-sent draft at once. They were one panel of stacked buttons,
 * which made them look like variations on a theme when in fact one is free and reversible, one rewrites the
 * opening line, and one spends money and discards your hand edits.
 *
 * Each is now its own card, saying up front how many drafts it would touch and — for the two deterministic
 * ones — letting you see the exact before and after on real drafts before anything is written.
 */
export function RewriteDrafts() {
  const [running, setRunning] = useState<"" | "rewrite" | "greeting" | "clean" | "contacts" | "redraft" | "people" | "audit">("");
  const [msg, setMsg] = useState("");
  const [greeting, setGreeting] = useState("Hi {first},");
  const [preview, setPreview] = useState<{ tool: "clean" | "greeting"; data: Preview } | null>(null);
  const [previewing, setPreviewing] = useState<"" | "clean" | "greeting">("");
  const [perCompany, setPerCompany] = useState(4);
  // The names taken off the contact list, so the result can be read rather than taken on trust.
  const [purged, setPurged] = useState<string[] | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);

  // The greeting field resets to the default on every reload, which reads as "my greeting didn't save."
  // Persist the last value locally so the panel reopens showing what the admin actually set.
  useEffect(() => {
    // localStorage is an external store only available on the client; hydrating from it must run in a
    // mount effect (not render/lazy-init) to avoid an SSR hydration mismatch on the input value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const saved = localStorage.getItem(GREETING_KEY); if (saved) setGreeting(saved); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(GREETING_KEY, greeting); } catch { /* ignore */ }
  }, [greeting]);

  async function runPreview(tool: "clean" | "greeting") {
    if (previewing || running) return;
    if (tool === "greeting" && !greeting.trim()) { setMsg("Type a greeting first."); return; }
    setPreviewing(tool); setMsg("");
    try {
      const response = await fetch("/api/admin/draft-preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, greeting }) });
      const json = await response.json();
      if (!response.ok) { setMsg(json.error ?? "Could not check the drafts."); return; }
      setPreview({ tool, data: json as Preview });
    } catch { setMsg("Could not check the drafts."); }
    finally { setPreviewing(""); }
  }

  // Repair drafts already saved with a repeated opener / stray link / the old "teardown" CTA. Deterministic
  // and free — no model calls — unlike "Regenerate drafts with AI".
  async function cleanUp() {
    if (running) return;
    if (!confirm("Clean up every un-sent draft? Removes repeated lines, links in the body, and the old “teardown” line. No AI, nothing is reworded.")) return;
    setRunning("clean"); setMsg("Cleaning drafts…");
    try {
      let offset = 0, fixed = 0, blanked = 0;
      for (let i = 0; i < 60; i++) {
        const res = await fetch("/api/admin/clean-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Clean-up failed."); return; }
        fixed += json.cleaned ?? 0; blanked += json.skipped ?? 0; offset = json.offset ?? offset;
        setMsg(`Checked ${offset} draft${offset === 1 ? "" : "s"}, fixed ${fixed}…`);
        if (json.done) break;
      }
      setPreview(null);
      setMsg(`Done — checked ${offset} drafts and fixed ${fixed}. Drafts that were already clean were left untouched${blanked ? `; ${blanked} skipped to avoid emptying them` : ""}. Reload the desk to see them.`);
    } catch { setMsg("Clean-up failed — try again."); }
    finally { setRunning(""); }
  }

  async function drain(url: string, extra: Record<string, unknown>, label: string, key: "rewritten" | "applied") {
    const before = new Date().toISOString();
    let total = 0;
    for (let i = 0; i < 60; i++) {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...extra, before }) });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Something went wrong."); return; }
      total += json[key] ?? 0;
      setMsg(`${label} ${total} so far${json.remaining ? ` · ${json.remaining} to go…` : ""}`);
      if (!json.remaining) { setPreview(null); setMsg(`Done — ${label.toLowerCase()} ${total} draft${total === 1 ? "" : "s"}. Reload the desk to see them.`); return; }
    }
  }

  async function rewrite() {
    if (running) return;
    if (!confirm("Regenerate every un-sent email draft with AI, using the latest founder-voice rules? This replaces anything you edited by hand, and uses AI credits. Each draft stays editable before you send.")) return;
    setRunning("rewrite"); setMsg("Regenerating drafts…");
    try { await drain("/api/admin/rewrite-drafts", {}, "Regenerated", "rewritten"); } catch { setMsg("Regenerate failed — try again."); }
    finally { setRunning(""); }
  }

  async function applyGreeting() {
    if (running) return;
    if (!greeting.trim()) { setMsg("Type a greeting first."); return; }
    if (!confirm(`Set the greeting on every un-sent email to “${greeting.trim()}” (with {first} replaced by each contact's first name)?`)) return;
    setRunning("greeting"); setMsg("Updating greeting…");
    try { await drain("/api/admin/apply-greeting", { greeting }, "Updated", "applied"); } catch { setMsg("Update failed — try again."); }
    finally { setRunning(""); }
  }

  // Write every contact worth emailing their own draft, angled at their role. Free: no model call.
  async function draftContacts() {
    if (running) return;
    if (!confirm(`Write a draft for up to ${perCompany} people at every company on the list? Each gets their own, aimed at what their role owns. Nothing already drafted or sent is touched, and it uses no AI credits.`)) return;
    setRunning("contacts"); setMsg("Writing drafts…");
    try {
      // One timestamp for the whole drain: every row this writes would otherwise match the source filter
      // and the run would keep finding its own output.
      const before = new Date().toISOString();
      let offset = 0, written = 0, failed = 0, done = false;
      for (let i = 0; i < 200; i++) {
        const res = await fetch("/api/admin/draft-contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset, perCompany, before }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Could not write the drafts."); return; }
        written += json.written ?? 0; failed += json.failed ?? 0; offset = json.offset ?? offset;
        setMsg(`Checked ${offset} compan${offset === 1 ? "y" : "ies"}, wrote ${written} draft${written === 1 ? "" : "s"}…`);
        if (json.done) { done = true; break; }
      }
      // Never report an exhausted loop as a finished run.
      if (!done) { setMsg(`Stopped after ${offset} companies with ${written} drafts written — there are more to do. Press it again to carry on.`); return; }
      setMsg(`Done — ${written} contact${written === 1 ? "" : "s"} now have their own draft${failed ? `; ${failed} compan${failed === 1 ? "y" : "ies"} were skipped after a database error` : ""}. Reload the desk and switch the list to “All active” to see them.`);
    } catch { setMsg("Could not write the drafts — try again."); }
    finally { setRunning(""); }
  }

  // Put every un-sent draft through the same composer, so the list reads as one voice. Free: no model call.
  async function redraftAll() {
    if (running) return;
    if (!confirm("Rewrite EVERY un-sent draft with the per-person writer? Each contact gets an email aimed at what their role owns. This replaces drafts you have edited by hand. Sent emails are never touched, and it uses no AI credits.")) return;
    setRunning("redraft"); setMsg("Rewriting drafts…");
    try {
      // One timestamp for the whole drain: every row this writes stays in the open statuses, so a moving
      // source set would let the run keep finding its own output.
      const before = new Date().toISOString();
      let offset = 0, written = 0, failed = 0, done = false;
      for (let i = 0; i < 200; i++) {
        const res = await fetch("/api/admin/redraft-all", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset, before }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Could not rewrite the drafts."); return; }
        written += json.written ?? 0; failed += json.failed ?? 0; offset = json.next ?? offset;
        setMsg(`Rewritten ${written} of ${json.total ?? "?"}…`);
        if (json.done) { done = true; break; }
      }
      // Never report an exhausted loop as a finished run.
      if (!done) { setMsg(`Stopped with ${written} rewritten — there are more to do. Press it again to carry on.`); return; }
      setMsg(`Done — ${written} draft${written === 1 ? "" : "s"} rewritten${failed ? `; ${failed} could not be saved` : ""}. Reload the desk to read them.`);
    } catch { setMsg("Could not rewrite the drafts — try again."); }
    finally { setRunning(""); }
  }

  // Take everything off the contact list that is not a person, and show what went.
  async function checkContacts() {
    if (running) return;
    if (!confirm("Check every contact on file and take off the ones that are not people — slogans, page titles and functional mailboxes? They stop being offered and stop being enriched. Nothing is deleted.")) return;
    setRunning("people"); setMsg("Checking the contact list…"); setPurged(null);
    try {
      const res = await fetch("/api/admin/purge-people", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setMsg(json.error ?? "Could not check the contact list."); return; }
      const names = (json.names ?? []) as string[];
      setPurged(names);
      setMsg(json.removed ? `Took ${json.removed} off the list.` : "Every contact on file looks like a person.");
    } catch { setMsg("Could not check the contact list — try again."); }
    finally { setRunning(""); }
  }

  // Check every draft on file against every rule. Read-only: nothing is written and nothing is sent.
  async function auditDrafts() {
    if (running) return;
    setRunning("audit"); setMsg("Reading every draft…"); setAudit(null);
    try {
      let offset = 0, done = false;
      const totals: AuditResult = { checked: 0, clean: 0, unsendable: 0, byRule: {}, problems: [] };
      for (let i = 0; i < 200; i++) {
        const res = await fetch("/api/admin/audit-drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offset }) });
        const json = await res.json();
        if (!res.ok) { setMsg(json.error ?? "Could not read the drafts."); return; }
        totals.checked += json.checked ?? 0;
        totals.clean += json.clean ?? 0;
        totals.unsendable += json.unsendable ?? 0;
        for (const [rule, n] of Object.entries((json.byRule ?? {}) as Record<string, number>)) totals.byRule[rule] = (totals.byRule[rule] ?? 0) + n;
        for (const problem of (json.problems ?? []) as Problem[]) if (totals.problems.length < 200) totals.problems.push(problem);
        offset = json.next ?? offset;
        setMsg(`Read ${totals.checked} of ${json.total ?? "?"}…`);
        if (json.done) { done = true; break; }
      }
      // Never report a partial pass as a finished audit.
      if (!done) { setMsg(`Stopped after ${totals.checked} drafts — there are more. Press it again to carry on.`); return; }
      setAudit(totals);
      setMsg(totals.checked === totals.clean
        ? `Read all ${totals.checked} un-sent drafts. Every one passed.`
        : `Read ${totals.checked} un-sent drafts: ${totals.clean} clean, ${totals.checked - totals.clean} with something wrong, ${totals.unsendable} that could not be sent as they stand.`);
    } catch { setMsg("Could not read the drafts — try again."); }
    finally { setRunning(""); }
  }

  const shown = preview?.data;

  return (
    <div className="draft-tools">
      {/* The three that fix a list end to end, in the order they should be pressed. Everything below them is
          a single change you reach for on purpose; these are a sequence, and running them out of order wastes
          the work — rewriting before the fake contacts are gone just writes emails to them. */}
      <p className="draft-tools-lead">Three steps put the whole list right: take off anything that is not a person, rewrite every un-sent draft with the same writer, then read back what is still wrong. Each is free and uses no AI. The rest below are single changes to reach for on purpose.</p>

{/* 0a — nothing else matters if the list is not people. */}
      <section className="draft-tool">
        <header>
          <div><h3><em className="draft-step">Step 1</em>Check the contact list</h3><p>Websites put their own sales copy in the same place as their people, so phrases get filed as contacts: &ldquo;Discover Untapped Performance&rdquo;, titled &ldquo;Your Industry Partner&rdquo;. Three capitalised words look exactly like a name. This finds them and takes them off.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <p className="panel-watch">Also catches page titles scraped as people (&ldquo;Modern Slavery Statement&rdquo;) and functional mailboxes (recruiting@, service@). They are marked do-not-contact, never deleted &mdash; and every name is listed below so you can see exactly what went.</p>
        <div className="draft-tool-actions">
          <button type="button" className="btn" disabled={!!running} onClick={checkContacts}>{running === "people" ? "Checking…" : "Check the contact list"}</button>
        </div>
        {purged && purged.length > 0 && (
          <ul className="draft-tool-list">
            {purged.map((name) => <li key={name}>{name}</li>)}
          </ul>
        )}
      </section>

{/* 0b — makes the list read as one voice. */}
      <section className="draft-tool">
        <header>
          <div><h3><em className="draft-step">Step 2</em>Make every draft read the same way</h3><p>The contact a company arrived with kept whatever was written for them at the time, while their colleagues got the per-person writer &mdash; so working down the list you met one email with the greeting doubled into the first line, the next with no subject, the next written properly. This puts all of them through the same writer.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <p className="panel-watch">Each contact is written to about what their role owns, from their company&rsquo;s own signal, with no AI call. <strong>It replaces drafts you have edited by hand.</strong> Emails already sent are never touched.</p>
        <div className="draft-tool-actions">
          <button type="button" className="btn" disabled={!!running} onClick={redraftAll}>{running === "redraft" ? "Rewriting…" : "Rewrite every un-sent draft"}</button>
        </div>
      </section>

{/* 0 — read before you write: what is actually wrong, by name. */}
      <section className="draft-tool">
        <header>
          <div><h3><em className="draft-step">Step 3</em>Audit every draft</h3><p>Reads every un-sent email on file and checks it against every rule at once: greets the right person, names the company, has a real subject, no placeholder left in, no link in the body, no role list read as a job title, within the length the send route accepts, and addressed to someone who is actually a person.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <p className="panel-watch">Read-only &mdash; nothing is written, nothing is sent, no AI is called. It names each draft that fails and says why, so the list can be checked rather than taken on trust.</p>
        <div className="draft-tool-actions">
          <button type="button" className="btn primary" disabled={!!running} onClick={auditDrafts}>{running === "audit" ? "Reading…" : "Audit every draft"}</button>
        </div>
        {audit && Object.keys(audit.byRule).length > 0 && (
          <ul className="draft-tool-list">
            {Object.entries(audit.byRule).sort((a, b) => b[1] - a[1]).map(([rule, n]) => <li key={rule}><strong>{n}</strong> &middot; {rule.replace(/-/g, " ")}</li>)}
          </ul>
        )}
        {audit && audit.problems.length > 0 && (
          <ul className="draft-tool-list">
            {audit.problems.map((problem) => (
              <li key={problem.id}>
                <strong>{problem.who}</strong> &middot; {problem.company}
                {problem.faults.map((fault) => <span key={fault.rule} className={`audit-fault ${fault.blocking ? "is-blocking" : ""}`}>{fault.says}</span>)}
              </li>
            ))}
          </ul>
        )}
      </section>

{/* 0 — writes the list you actually work. */}
      <section className="draft-tool">
        <header>
          <div><h3>Write a draft for every contact</h3><p>Everyone worth emailing at every company gets their own draft, aimed at what their role owns: a CFO is asked about cost, an engineering lead about what gets built, a CEO about headcount. Same evidence, different email.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <p className="panel-watch">Written from each company&rsquo;s own signal, with no AI call, so the whole list costs nothing. Anything already drafted or sent is left alone. The new drafts appear under <strong>All active</strong> on the desk rather than today&rsquo;s worklist.</p>
        <label className="draft-tool-row">
          <span>People per company</span>
          <select value={perCompany} onChange={(event) => setPerCompany(Number(event.target.value))}>
            {[2, 3, 4, 5, 6, 8, 10].map((count) => <option key={count} value={count}>{count}</option>)}
          </select>
          <small>Most senior first, verified addresses ahead of guessed ones &mdash; a company can carry forty contacts and you don&rsquo;t want all of them on the desk.</small>
        </label>
        <div className="draft-tool-actions">
          <button type="button" className="btn primary" disabled={!!running} onClick={draftContacts}>{running === "contacts" ? "Writing…" : "Write the drafts"}</button>
        </div>
      </section>

      {/* 1 — the safe one, first on purpose. */}
      <section className="draft-tool">
        <header>
          <div><h3>Clean up drafts</h3><p>Removes an opening line that saved twice, a stray link in the body, and the old &ldquo;teardown&rdquo; sentence. Nothing is reworded.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <div className="draft-tool-actions">
          <button type="button" className="btn" disabled={!!running || !!previewing} onClick={() => runPreview("clean")}>{previewing === "clean" ? "Checking…" : "Preview changes"}</button>
          <button type="button" className="btn primary" disabled={!!running} onClick={cleanUp}>{running === "clean" ? "Cleaning…" : "Clean up drafts"}</button>
        </div>
        {preview?.tool === "clean" && shown && <PreviewBlock data={shown} />}
      </section>

      {/* 2 — rewrites one line across the list. */}
      <section className="draft-tool">
        <header>
          <div><h3>Update greeting</h3><p>Replaces the opening line of every un-sent email. Write <code>{"{first}"}</code> where the first name goes, so <em>Hi {"{first}"},</em> reaches Robert as <em>Hi Robert,</em>. The rest of each email is untouched.</p></div>
          <span className="panel-cost is-free">Free</span>
        </header>
        <input
          value={greeting}
          onChange={(event) => { setGreeting(event.target.value); if (preview?.tool === "greeting") setPreview(null); }}
          placeholder="Hi {first},"
          className="draft-tool-input"
        />
        <div className="draft-tool-actions">
          <button type="button" className="btn" disabled={!!running || !!previewing} onClick={() => runPreview("greeting")}>{previewing === "greeting" ? "Checking…" : "Preview changes"}</button>
          <button type="button" className="btn primary" disabled={!!running} onClick={applyGreeting}>{running === "greeting" ? "Updating…" : "Update greeting"}</button>
        </div>
        {preview?.tool === "greeting" && shown && <PreviewBlock data={shown} />}
      </section>

      {/* 3 — the expensive, destructive one, last and clearly marked. */}
      <section className="draft-tool">
        <header>
          <div><h3>Regenerate drafts with AI</h3><p>Writes every un-sent email again from scratch with the current rules: plain language, specific to that company, no buzzwords. Use it when the drafts read generically.</p></div>
          <span className="panel-cost is-paid">Uses AI credits</span>
        </header>
        <p className="panel-watch">This replaces what is there, so anything you edited by hand is lost, and it calls the model once per draft. There is no preview — the wording only exists once it has been written.</p>
        <div className="draft-tool-actions">
          <button type="button" className="btn" disabled={!!running} onClick={rewrite}>{running === "rewrite" ? "Regenerating…" : "Regenerate drafts with AI"}</button>
        </div>
      </section>

      {msg && <p className="notice" role="status">{msg}</p>}
    </div>
  );
}

/** How many drafts change, and the exact before/after on real ones. */
function PreviewBlock({ data }: { data: Preview }) {
  if (!data.wouldChange) {
    return <p className="draft-preview-empty">Nothing to change — all {data.total} un-sent draft{data.total === 1 ? "" : "s"} are already like this.</p>;
  }
  return (
    <div className="draft-preview">
      <p className="draft-preview-count">
        <strong>{data.wouldChange}</strong> of {data.exact ? data.total : `the first ${data.scanned} checked`} un-sent draft{data.wouldChange === 1 ? "" : "s"} would change
        {!data.exact && <> &mdash; the remaining {data.total - data.scanned} are checked when it runs</>}.
      </p>
      {data.samples.map((sample, index) => (
        <details key={index} className="draft-preview-item">
          <summary>{sample.name}</summary>
          <div className="draft-preview-diff">
            <div><span>Now</span><pre>{sample.before}</pre></div>
            <div><span>After</span><pre>{sample.after}</pre></div>
          </div>
        </details>
      ))}
    </div>
  );
}
