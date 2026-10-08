"use client";

import Link from "next/link";
import { useState } from "react";
import { outreachBody, outreachEmailHtml } from "@/lib/outreach-ending";

export type ReviewDraft = {
  id: string; updatedAt: string; status: string; subject: string; body: string;
  name: string; title: string; company: string; email: string | null; confirmed: boolean; sendable: boolean;
  /** Curated companies send the short form of the body and no opt-out line, exactly as card-send does. */
  curated: boolean; why: string | null;
};
export type ReviewSender = { fromName: string; signature?: string; postalAddress?: string };

type Filter = "todo" | "all" | "unconfirmed" | "noAddress";
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Every unsent email in one place to read, fix and mark as reviewed, without opening each company on the
 * Reach-out list. "Looks good" uses the existing approved status (sending treats it like any unsent draft).
 * Saves go through the desk's own route with its version check, so a change made elsewhere is reported,
 * never overwritten.
 */
export function DraftReview({ drafts: initial, listHref, sender, optOut }: { drafts: ReviewDraft[]; listHref: string; sender: ReviewSender; optOut: string }) {
  const [drafts, setDrafts] = useState(initial);
  const [filter, setFilter] = useState<Filter>(initial.some((d) => d.sendable && d.status !== "approved") ? "todo" : "all");
  // Which open email is being edited; an open email otherwise shows read-only, exactly as it will be sent.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ subject: string; body: string }>({ subject: "", body: "" });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string; ok: boolean; conflict?: boolean } | null>(null);

  const reviewed = (draft: ReviewDraft) => draft.status === "approved";
  // Emails with no usable address cannot be sent, so they only show under their own filter.
  const matches = (draft: ReviewDraft, which: Filter) => which === "noAddress" ? !draft.sendable : draft.sendable && (which === "all" || (which === "todo" ? !reviewed(draft) : !draft.confirmed));
  const shown = drafts.filter((draft) => matches(draft, filter));
  const count = (which: Filter) => drafts.filter((draft) => matches(draft, which)).length;
  const sendable = drafts.filter((draft) => draft.sendable);
  const doneCount = sendable.filter(reviewed).length;

  // The email as the recipient will get it: the same body transform, signature, postal line and opt-out.
  const emailHtml = (draft: ReviewDraft, body: string) => `${outreachEmailHtml(draft.curated ? outreachBody(body) : body, sender)}${draft.curated ? "" : `<p style="font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b645a">${escapeHtml(optOut)}</p>`}`;

  function open(draft: ReviewDraft) {
    setOpenId(draft.id);
    setEditingId(null);
    setEdit({ subject: draft.subject, body: draft.body });
    setNotice(null);
  }

  async function patch(draft: ReviewDraft, change: Record<string, unknown>) {
    const response = await fetch(`/api/cards/${draft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...change, expected_updated_at: draft.updatedAt }) });
    const json = await response.json().catch(() => ({})) as { updated_at?: string; status?: string; email_subject?: string; email_body?: string; error?: string };
    if (!response.ok) {
      setNotice({ id: draft.id, text: response.status === 409 ? "Not saved: this email was changed somewhere else (or sent) since you opened it. Your text is still here." : json.error ?? "Not saved. Your text is still here; try again.", ok: false, conflict: response.status === 409 });
      return null;
    }
    const next = { ...draft, subject: json.email_subject ?? draft.subject, body: json.email_body ?? draft.body, status: json.status ?? draft.status, updatedAt: json.updated_at ?? draft.updatedAt };
    setDrafts((current) => current.map((item) => item.id === draft.id ? next : item));
    return next;
  }

  /** Save any edit; with `approve`, also mark it reviewed and move to the next one still to review. */
  async function save(draft: ReviewDraft, approve: boolean) {
    const editing = editingId === draft.id;
    const changed = editing && (edit.subject !== draft.subject || edit.body !== draft.body);
    if (changed && (!edit.subject.trim() || !edit.body.trim())) { setNotice({ id: draft.id, text: "An email needs a subject and a message.", ok: false }); return; }
    if (!changed && !approve) { setEditingId(null); return; }
    setSaving(true);
    try {
      const saved = await patch(draft, { ...(changed ? { email_subject: edit.subject, email_body: edit.body } : {}), ...(approve ? { status: "approved" } : {}) });
      if (!saved) return;
      if (!approve) { setEditingId(null); setNotice({ id: draft.id, text: "Saved.", ok: true }); return; }
      const order = drafts.filter((item) => matches(item, filter === "todo" ? "all" : filter));
      const index = order.findIndex((item) => item.id === draft.id);
      const next = [...order.slice(index + 1), ...order.slice(0, index)].find((item) => !reviewed(item) && item.id !== draft.id);
      setNotice({ id: draft.id, text: "Marked as reviewed.", ok: true });
      if (next) {
        open(next);
        requestAnimationFrame(() => document.getElementById(`review-${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
      } else { setOpenId(null); setEditingId(null); }
    } catch { setNotice({ id: draft.id, text: "Not saved: the connection dropped. Your text is still here; try again.", ok: false }); }
    finally { setSaving(false); }
  }

  async function unreview(draft: ReviewDraft) {
    setSaving(true);
    try { if (await patch(draft, { status: "edited" })) setNotice({ id: draft.id, text: "Moved back to not reviewed.", ok: true }); }
    finally { setSaving(false); }
  }

  async function loadSaved(draft: ReviewDraft) {
    const response = await fetch(`/api/cards/${draft.id}`, { cache: "no-store" });
    const json = await response.json().catch(() => ({})) as { updated_at?: string; email_subject?: string | null; email_body?: string | null; status?: string; error?: string };
    if (!response.ok) { setNotice({ id: draft.id, text: json.error ?? "Could not load the saved version.", ok: false, conflict: true }); return; }
    if (json.status && !["new", "edited", "approved"].includes(json.status)) {
      setDrafts((current) => current.filter((item) => item.id !== draft.id));
      setOpenId(null);
      setNotice({ id: draft.id, text: "That email has already been sent, so it is off this list.", ok: true });
      return;
    }
    const saved = { subject: json.email_subject ?? "", body: json.email_body ?? "" };
    setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, ...saved, status: json.status ?? item.status, updatedAt: json.updated_at ?? item.updatedAt } : item));
    setEdit(saved);
    setNotice({ id: draft.id, text: "Showing the saved version. Edit it and save again if you like.", ok: true });
  }

  // The paragraph about their company, not the greeting or the intro every email shares.
  const preview = (body: string, company: string) => {
    const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(1);
    const word = company.split(/\s+/)[0]?.toLowerCase() ?? "";
    return lines.find((line) => word && line.toLowerCase().includes(word)) ?? lines[1] ?? lines[0] ?? "";
  };
  const badge = (draft: ReviewDraft) => <span className={`address-badge ${draft.confirmed ? "is-confirmed" : draft.sendable ? "is-unconfirmed" : "is-missing"}`}>{draft.confirmed ? "Confirmed" : draft.sendable ? "Unconfirmed" : "No address"}</span>;
  const noteFor = (draft: ReviewDraft) => (notice?.id === draft.id ? notice : null);

  const actionsNote = (draft: ReviewDraft) => {
    const note = noteFor(draft);
    return <>
      {note && <span className={`review-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</span>}
      {note?.conflict && <button type="button" className="btn" onClick={() => void loadSaved(draft)}>Load the saved version</button>}
    </>;
  };

  // Open, read-only: the whole email as it will go out, with the one decision to make.
  const reader = (draft: ReviewDraft) => (
    <div className="review-editor">
      {draft.why && <p className="composer-why"><b>Why this company:</b> {draft.why}</p>}
      <p className="review-to">To {draft.name}{draft.email ? ` · ${draft.email}` : " · no address on file"}</p>
      <h3 className="review-subject">{draft.subject || "No subject"}</h3>
      <div className="review-email" dangerouslySetInnerHTML={{ __html: emailHtml(draft, draft.body) }} />
      <div className="review-actions">
        {reviewed(draft)
          ? <button type="button" className="btn ghost" disabled={saving} onClick={() => void unreview(draft)}>Mark not reviewed</button>
          : <button type="button" className="btn primary" disabled={saving} onClick={() => void save(draft, true)}>{saving ? "Saving…" : "Looks good, next"}</button>}
        <button type="button" className="btn" disabled={saving} onClick={() => { setEdit({ subject: draft.subject, body: draft.body }); setEditingId(draft.id); setNotice(null); }}>Edit</button>
        <button type="button" className="btn ghost" disabled={saving} onClick={() => setOpenId(null)}>Close</button>
        <Link className="review-open" href={`${listHref}&card=${draft.id}`}>Open on the Reach-out list &rarr;</Link>
        {actionsNote(draft)}
      </div>
    </div>
  );

  const editor = (draft: ReviewDraft) => (
    <div className="review-editor">
      {draft.why && <p className="composer-why"><b>Why this company:</b> {draft.why}</p>}
      <p className="review-to">To {draft.name}{draft.email ? ` · ${draft.email}` : " · no address on file"}</p>
      <label><span>Subject</span><input value={edit.subject} maxLength={120} onChange={(event) => setEdit((e) => ({ ...e, subject: event.target.value }))} /></label>
      <label><span>Message</span><textarea rows={10} maxLength={1000} value={edit.body} onChange={(event) => setEdit((e) => ({ ...e, body: event.target.value }))} /></label>
      <details className="review-as-sent"><summary>See it exactly as it will be sent</summary><div className="review-email" dangerouslySetInnerHTML={{ __html: emailHtml(draft, edit.body) }} /></details>
      <div className="review-actions">
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save(draft, true)}>{saving ? "Saving…" : "Save, looks good, next"}</button>
        <button type="button" className="btn" disabled={saving} onClick={() => void save(draft, false)}>Save</button>
        <button type="button" className="btn ghost" disabled={saving} onClick={() => setEditingId(null)}>Cancel</button>
        {actionsNote(draft)}
      </div>
    </div>
  );

  return (
    <section className="draft-review" aria-label="Review emails">
      <div className="review-head">
        <h2>Review your emails</h2>
        <p>Click an email to read it as it will be sent. Press <b>Looks good</b> to move to the next one, or <b>Edit</b> to change it. Changes save to the same email on the Reach-out list.</p>
        <div className="review-progress" aria-label="Progress"><progress max={Math.max(sendable.length, 1)} value={doneCount} /><span><b>{doneCount}</b> of {sendable.length} reviewed</span></div>
        <div className="review-filters" role="tablist" aria-label="Show">
          {([["todo", "Not reviewed yet"], ["all", "All"], ["unconfirmed", "Unconfirmed address"], ["noAddress", "No address"]] as Array<[Filter, string]>).filter(([key]) => key !== "noAddress" || count("noAddress") > 0).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => { setFilter(key); setOpenId(null); }}>{label} ({count(key)})</button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <p className="review-empty">{filter === "todo" ? "All done. Every email has been reviewed." : "Nothing here."}</p> : (
        <ol className="review-list">
          {shown.map((draft) => {
            const isOpen = openId === draft.id;
            const note = noteFor(draft);
            return (
              <li key={draft.id} id={`review-${draft.id}`} className={`review-item ${isOpen ? "is-open" : ""} ${reviewed(draft) ? "is-reviewed" : ""}`}>
                <button type="button" className="review-row" aria-expanded={isOpen} onClick={() => (isOpen ? setOpenId(null) : open(draft))}>
                  <span className="review-who"><b>{draft.name}</b><small>{draft.title ? `${draft.title} · ` : ""}{draft.company}</small></span>
                  <span className="review-mail"><b>{draft.subject || "No subject"}</b><small>{preview(draft.body, draft.company)}</small></span>
                  <span className="review-tags">{reviewed(draft) && <span className="review-done">Reviewed</span>}{badge(draft)}<span className="review-caret" aria-hidden="true">{isOpen ? "▴" : "▾"}</span></span>
                </button>
                {!isOpen && note && <p className={`review-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</p>}
                {isOpen && (editingId === draft.id ? editor(draft) : reader(draft))}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
