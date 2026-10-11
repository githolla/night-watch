"use client";

import Link from "next/link";
import { ArrowRight, CalendarDots, CaretLeft, CaretRight, Check, MagnifyingGlass, Sparkle, TextAlignLeft, TextT, WarningCircle, type Icon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { CompanyLogo } from "@/components/CompanyLogo";
import { InlineConfirm } from "@/components/InlineConfirm";
import type { WorkspaceDraft, WorkspacePlan } from "@/lib/draft-workspace";
import { outreachBody, outreachEmailHtml } from "@/lib/outreach-ending";

export type ReviewSender = { fromName: string; signature?: string; postalAddress?: string };
type Tab = "review" | "approved" | "held" | "missing";
type Change = { status?: string; auto_send_hold?: boolean; email_subject?: string; email_body?: string };
type Saved = { updated_at?: string; status?: string; email_subject?: string | null; email_body?: string | null; auto_send_hold?: boolean; error?: string };

const PAGE = 10;
const TABS: Array<[Tab, string]> = [["review", "Needs review"], ["approved", "Approved"], ["held", "Held"], ["missing", "No address"]];
const SUGGEST: Array<{ key: string; label: string; icon: Icon; instruction: string }> = [
  { key: "shorten", label: "Shorten", icon: TextAlignLeft, instruction: "Make it shorter and tighter. Keep the facts, the ask and the sign-off." },
  { key: "opening", label: "Improve opening", icon: Sparkle, instruction: "Rewrite only the first paragraph after the greeting so it is specific to this company. Keep everything else." },
  { key: "subject", label: "Suggest subject", icon: TextT, instruction: "Suggest a better subject line, specific to this company, under 60 characters. Keep the body as it is." },
];
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tabOf = (draft: WorkspaceDraft): Tab => !draft.sendable ? "missing" : draft.held ? "held" : draft.status === "approved" ? "approved" : "review";
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Review every unsent email in one workspace: the queue on the left, the editable email in the middle and the
 * research on the right. Approve uses the card's "approved" status; it does not send anything. Saves go through
 * the desk's route with its version check, so a change made elsewhere is reported, never overwritten.
 */
export function DraftWorkspace({ drafts: initial, plan, owner, sender, optOut, listHref, canAct, startTab }: {
  drafts: WorkspaceDraft[]; plan: WorkspacePlan | null; owner: string; sender: ReviewSender; optOut: string; listHref: string; canAct: boolean;
  /** A tab asked for in the link (Overview's "ready to send" opens Approved). */
  startTab?: string;
}) {
  const [drafts, setDrafts] = useState(initial);
  const asked = TABS.find(([key]) => key === startTab)?.[0];
  const [tab, setTab] = useState<Tab>(asked ?? TABS.map(([key]) => key).find((key) => initial.some((draft) => tabOf(draft) === key)) ?? "review");
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [page, setPage] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [channel, setChannel] = useState<"email" | "linkedin">("email");
  const [preview, setPreview] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean; conflict?: string } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const counts = useMemo(() => {
    const tally: Record<Tab, number> = { review: 0, approved: 0, held: 0, missing: 0 };
    for (const draft of drafts) tally[tabOf(draft)]++;
    return tally;
  }, [drafts]);
  const sectors = useMemo(() => [...new Set(drafts.map((draft) => draft.industry))].sort(), [drafts]);
  const needle = query.trim().toLowerCase();
  const shown = drafts.filter((draft) => tabOf(draft) === tab && (sector === "all" || draft.industry === sector) && (!needle || `${draft.company} ${draft.name} ${draft.title} ${draft.subject}`.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const at = Math.min(page, pages - 1);
  const pageDrafts = shown.slice(at * PAGE, at * PAGE + PAGE);
  const current = shown.find((draft) => draft.id === currentId) ?? pageDrafts[0] ?? null;
  const editing = current && edit?.id === current.id ? edit : current ? { id: current.id, subject: current.subject, body: current.body } : null;
  const dirty = Boolean(current && editing && (editing.subject !== current.subject || editing.body !== current.body));
  const chosen = drafts.filter((draft) => selected.has(draft.id));
  const sendable = drafts.filter((draft) => draft.sendable);
  const reviewedCount = sendable.filter((draft) => draft.status === "approved").length;

  const next = plan ? drafts.filter((draft) => draft.slot && draft.slot.position > 0 && draft.slot.position <= plan.going) : [];
  const nextUnapproved = next.filter((draft) => draft.status !== "approved");
  const day = plan ? plan.dayLabel.charAt(0).toUpperCase() + plan.dayLabel.slice(1) : "";

  const emailHtml = (draft: WorkspaceDraft, body: string) => `${outreachEmailHtml(draft.curated ? outreachBody(body) : body, sender)}${draft.curated ? "" : `<p style="font:400 13px/1.5 Arial,Helvetica,sans-serif;color:#6b645a">${escapeHtml(optOut)}</p>`}`;

  function open(draft: WorkspaceDraft | undefined) {
    if (!draft) return;
    setCurrentId(draft.id);
    setEdit(null);
    setPreview(false);
    setChannel("email");
    setNotice(null);
    setCopied(false);
  }
  function chooseTab(next: Tab) { setTab(next); setPage(0); setCurrentId(null); setEdit(null); setSelected(new Set()); setNotice(null); }

  /** The next draft still in this tab after `draft`, across pages, so Approve & next keeps going. */
  function after(draft: WorkspaceDraft, gone: Set<string>) {
    const index = shown.findIndex((item) => item.id === draft.id);
    const rest = [...shown.slice(index + 1), ...shown.slice(0, index)].filter((item) => !gone.has(item.id));
    const target = rest[0];
    if (!target) { setCurrentId(null); setEdit(null); return; }
    const remaining = shown.filter((item) => !gone.has(item.id));
    setPage(Math.floor(remaining.findIndex((item) => item.id === target.id) / PAGE));
    open(target);
  }

  async function patch(draft: WorkspaceDraft, change: Change): Promise<WorkspaceDraft | null> {
    const versioned = change.status !== undefined || change.email_body !== undefined || change.email_subject !== undefined;
    const response = await fetch(`/api/cards/${draft.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...change, ...(versioned ? { expected_updated_at: draft.updatedAt } : {}) }) }).catch(() => null);
    const json = await response?.json().catch(() => ({})) as Saved | undefined;
    if (!response?.ok) {
      setNotice(response?.status === 409
        ? { text: `${draft.company}: this email was changed somewhere else (or sent) since you opened it. Your text is still here.`, ok: false, conflict: draft.id }
        : { text: `${draft.company}: ${json?.error ?? "not saved, the connection dropped. Your text is still here; try again."}`, ok: false });
      return null;
    }
    const saved: WorkspaceDraft = {
      ...draft, status: json?.status ?? draft.status, updatedAt: json?.updated_at ?? draft.updatedAt,
      subject: json?.email_subject ?? draft.subject, body: json?.email_body ?? draft.body, held: json?.auto_send_hold ?? draft.held,
    };
    setDrafts((list) => change.status === "dismissed" ? list.filter((item) => item.id !== draft.id) : list.map((item) => item.id === draft.id ? saved : item));
    return saved;
  }

  async function loadSaved(id: string) {
    const draft = drafts.find((item) => item.id === id);
    if (!draft) return;
    const response = await fetch(`/api/cards/${id}`, { cache: "no-store" }).catch(() => null);
    const json = await response?.json().catch(() => ({})) as Saved | undefined;
    if (!response?.ok) { setNotice({ text: json?.error ?? "Could not load the saved version.", ok: false, conflict: id }); return; }
    if (json?.status && !["new", "edited", "approved"].includes(json.status)) {
      setDrafts((list) => list.filter((item) => item.id !== id));
      setNotice({ text: "That email has already been sent, so it is off this list.", ok: true });
      return;
    }
    const saved = { subject: json?.email_subject ?? "", body: json?.email_body ?? "" };
    setDrafts((list) => list.map((item) => item.id === id ? { ...item, ...saved, status: json?.status ?? item.status, updatedAt: json?.updated_at ?? item.updatedAt } : item));
    setEdit({ id, ...saved });
    setNotice({ text: "Showing the saved version. Edit it and save again if you like.", ok: true });
  }

  async function approve(draft: WorkspaceDraft) {
    if (!editing) return;
    if (dirty && (!editing.subject.trim() || !editing.body.trim())) { setNotice({ text: "An email needs a subject and a message.", ok: false }); return; }
    setBusy("approve");
    const saved = await patch(draft, { ...(dirty ? { email_subject: editing.subject, email_body: editing.body } : {}), status: "approved" });
    setBusy(null);
    if (!saved) return;
    after(draft, new Set([draft.id]));
    setNotice({ text: `${draft.company}: approved. Approval does not send it.`, ok: true });
  }

  async function save(draft: WorkspaceDraft) {
    if (!editing || !dirty) return;
    if (!editing.subject.trim() || !editing.body.trim()) { setNotice({ text: "An email needs a subject and a message.", ok: false }); return; }
    setBusy("save");
    const saved = await patch(draft, { email_subject: editing.subject, email_body: editing.body });
    setBusy(null);
    if (saved) { setEdit(null); setNotice({ text: "Saved.", ok: true }); }
  }

  async function suggest(draft: WorkspaceDraft, instruction: string, key: string) {
    if (!editing) return;
    setBusy(key);
    setNotice(null);
    try {
      const response = await fetch(`/api/cards/${draft.id}/refine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "email", subject: editing.subject, body: editing.body, instruction }) });
      const json = await response.json().catch(() => ({})) as { subject?: string; body?: string; error?: string };
      if (!response.ok || !json.body) { setNotice({ text: json.error ?? "No suggestion came back. Try again.", ok: false }); return; }
      // The suggestion is saved as an edit; read back its version so the next save passes the version check.
      const fresh = await fetch(`/api/cards/${draft.id}`, { cache: "no-store" }).then((r) => r.json() as Promise<Saved>).catch(() => null);
      const next = { subject: json.subject ?? editing.subject, body: json.body };
      setDrafts((list) => list.map((item) => item.id === draft.id ? { ...item, ...next, status: fresh?.status ?? "edited", updatedAt: fresh?.updated_at ?? item.updatedAt } : item));
      setEdit(null);
      setNotice({ text: "Suggestion applied and saved as an edit. Read it before you approve.", ok: true });
    } catch { setNotice({ text: "No suggestion: the connection dropped.", ok: false }); }
    finally { setBusy(null); }
  }

  async function run(targets: WorkspaceDraft[], change: Change, done: string) {
    setBusy("bulk");
    setNotice(null);
    let ok = 0;
    for (const target of targets) if (await patch(target, change)) ok++;
    setBusy(null);
    setSelected(new Set());
    if (ok) setNotice((prior) => prior && !prior.ok && ok < targets.length ? prior : { text: `${ok === 1 && targets.length === 1 ? targets[0].company : plural(ok, "draft", "drafts")}: ${done}`, ok: true });
  }

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || !current) return;
    const index = pageDrafts.findIndex((item) => item.id === current.id);
    const key = event.key.toLowerCase();
    if (key === "j" || key === "arrowdown") { event.preventDefault(); open(pageDrafts[index + 1]); }
    if (key === "k" || key === "arrowup") { event.preventDefault(); open(pageDrafts[index - 1]); }
    if (key === "a" && canAct && tab !== "approved") { event.preventDefault(); void approve(current); }
  }

  const pageAll = pageDrafts.length > 0 && pageDrafts.every((draft) => selected.has(draft.id));
  const allResults = shown.length > 0 && shown.every((draft) => selected.has(draft.id));
  const toggle = (id: string) => setSelected((set) => { const copy = new Set(set); if (copy.has(id)) copy.delete(id); else copy.add(id); return copy; });
  const tabName = TABS.find(([key]) => key === tab)?.[1] ?? "";
  const position = current ? shown.findIndex((draft) => draft.id === current.id) + 1 : 0;
  const fitLabel = (score: number) => score >= 70 ? "Good" : score >= 45 ? "Fair" : "Weak";

  return (
    <section className="dw" aria-label="Review emails" onKeyDown={onKey}>
      {plan && (
        <div className={`dw-banner ${nextUnapproved.length ? "is-todo" : ""}`}>
          <CalendarDots size={22} aria-hidden="true" />
          <div>
            <b>{nextUnapproved.length ? `${plural(nextUnapproved.length, "email", "emails")} sending ${day} ${nextUnapproved.length === 1 ? "is" : "are"} not approved yet` : next.length ? `All ${next.length} emails sending ${day} are approved` : `Nothing is set to send ${day}`}</b>
            <small>{plan.going} in the next window · {plan.windowLabel} ET · {plan.dailyCap}-email daily limit · {plan.autoSend ? "Auto-send on" : "Auto-send off"}</small>
          </div>
          {nextUnapproved.length > 0 && <button type="button" className="dw-link" onClick={() => { chooseTab("review"); const target = nextUnapproved[0]; const list = drafts.filter((draft) => tabOf(draft) === "review"); setPage(Math.floor(list.findIndex((draft) => draft.id === target.id) / PAGE)); open(target); }}>Resume review <ArrowRight size={15} aria-hidden="true" /></button>}
        </div>
      )}

      <div className="dw-toolbar">
        <div className="dw-filters">
          {sectors.length > 1 && (
            <label className="dw-field"><span className="sr-only">Sector</span>
              <select value={sector} onChange={(event) => { setSector(event.target.value); setPage(0); setCurrentId(null); }}>
                <option value="all">All sectors</option>
                {sectors.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
          )}
          <label className="dw-field is-search"><MagnifyingGlass size={15} aria-hidden="true" /><span className="sr-only">MagnifyingGlass drafts</span><input type="search" placeholder="Search drafts" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); setCurrentId(null); }} /></label>
          <span className="review-progress" aria-label="Progress"><b>{reviewedCount}</b> of {sendable.length} reviewed</span>
        </div>
        <div className="dw-tabs review-filters" role="tablist" aria-label="Show">
          {TABS.filter(([key]) => key !== "missing" || counts.missing > 0).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => chooseTab(key)}>{label} <span>{counts[key]}</span></button>
          ))}
        </div>
      </div>

      {canAct && chosen.length > 0 && (
        <div className="dw-bulk" role="toolbar" aria-label="Selected drafts">
          <b>{plural(chosen.length, "draft", "drafts")} selected in {tabName}</b>
          {tab !== "approved" && tab !== "missing" && <button type="button" className="dw-btn is-light" disabled={busy !== null} onClick={() => void run(chosen.filter((draft) => draft.status !== "approved"), { status: "approved" }, "approved. Approval does not send them.")}>Approve {chosen.length}</button>}
          {tab === "approved" && <button type="button" className="dw-btn is-light" disabled={busy !== null} onClick={() => void run(chosen, { status: "edited" }, "moved back to Needs review.")}>Move {chosen.length} back to review</button>}
          {tab !== "held" ? <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => void run(chosen, { auto_send_hold: true }, "held. Auto-send skips them.")}>Hold {chosen.length}</button>
            : <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => void run(chosen, { auto_send_hold: false }, "released to auto-send.")}>Release {chosen.length}</button>}
          <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => setConfirmDrop(chosen.map((draft) => draft.id))}>Not a fit</button>
          <button type="button" className="dw-link is-light" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {confirmDrop && (
        <InlineConfirm title={`Drop ${plural(confirmDrop.length, "draft", "drafts")} as not a fit?`} yes="Not a fit" busy={busy !== null} onCancel={() => setConfirmDrop(null)}
          onYes={() => { const targets = drafts.filter((draft) => confirmDrop.includes(draft.id)); setConfirmDrop(null); if (current && confirmDrop.includes(current.id)) after(current, new Set(confirmDrop)); void run(targets, { status: "dismissed" }, "dropped. They won't be sent."); }}>
          They leave every list and won&rsquo;t be sent. Nothing already sent changes.
        </InlineConfirm>
      )}
      {notice && (
        <p className={`dw-notice review-note ${notice.ok ? "is-ok" : "is-bad"}`} role="status">
          {notice.text}
          {notice.conflict && <button type="button" className="btn" onClick={() => void loadSaved(notice.conflict!)}>Load the saved version</button>}
        </p>
      )}

      {shown.length === 0
        ? <p className="review-empty dw-empty">{tab === "review" ? (needle || sector !== "all" ? "Nothing matches." : "All done. Every email has been reviewed.") : "Nothing here."}</p>
        : (
          <div className="dw-cols">
            <aside className="dw-queue" aria-label={tabName}>
              <div className="dw-queue-head">
                <h2>{tabName}</h2>
                {canAct && <label className="dw-select"><input type="checkbox" checked={pageAll} onChange={() => setSelected((set) => { const copy = new Set(set); for (const draft of pageDrafts) { if (pageAll) copy.delete(draft.id); else copy.add(draft.id); } return copy; })} />Select page ({pageDrafts.length})</label>}
                {canAct && shown.length > pageDrafts.length && <button type="button" className="dw-link" onClick={() => setSelected(allResults ? new Set() : new Set(shown.map((draft) => draft.id)))}>{allResults ? "Clear all" : `Select all ${shown.length} results`}</button>}
              </div>
              <ol className="dw-list review-list">
                {pageDrafts.map((draft) => (
                  <li key={draft.id} className={`review-item ${current?.id === draft.id ? "is-open" : ""} ${selected.has(draft.id) ? "is-picked" : ""} ${draft.status === "approved" ? "is-reviewed" : ""}`}>
                    {canAct && <input type="checkbox" className="dw-check" checked={selected.has(draft.id)} onChange={() => toggle(draft.id)} aria-label={`Select ${draft.company}`} />}
                    <CompanyLogo domain={draft.domain} name={draft.company} size={34} />
                    <button type="button" className="review-row" aria-expanded={current?.id === draft.id} onClick={() => open(draft)}>
                      <span className="review-who"><b>{draft.company}</b><small>{draft.name}{draft.title ? ` · ${draft.title}` : ""}</small></span>
                      <span className={`dw-addr ${draft.confirmed ? "is-ok" : draft.sendable ? "is-warn" : "is-bad"}`}>{draft.confirmed ? <Check size={14} aria-hidden="true" /> : <WarningCircle size={14} aria-hidden="true" />}{draft.confirmed ? "Email verified" : draft.sendable ? "Needs verification" : "No address"}</span>
                    </button>
                  </li>
                ))}
              </ol>
              {pages > 1 && (
                <nav className="dw-pages" aria-label="Pages">
                  <span>{at * PAGE + 1}&ndash;{at * PAGE + pageDrafts.length} of {shown.length}</span>
                  <button type="button" aria-label="Previous page" disabled={at === 0} onClick={() => { setPage(at - 1); setCurrentId(null); }}><CaretLeft size={16} /></button>
                  {Array.from({ length: pages }, (_, index) => index).filter((index) => pages <= 7 || Math.abs(index - at) <= 2 || index === 0 || index === pages - 1).map((index) => (
                    <button key={index} type="button" aria-current={index === at ? "page" : undefined} className={index === at ? "is-on" : ""} onClick={() => { setPage(index); setCurrentId(null); }}>{index + 1}</button>
                  ))}
                  <button type="button" aria-label="Next page" disabled={at >= pages - 1} onClick={() => { setPage(at + 1); setCurrentId(null); }}><CaretRight size={16} /></button>
                </nav>
              )}
            </aside>

            {current && editing && (
              <article className="dw-editor review-editor" aria-label={`Email to ${current.name}`}>
                <header className="dw-editor-head">
                  <CompanyLogo domain={current.domain} name={current.company} size={48} className="is-lg" />
                  <div className="dw-editor-title"><h2>{current.company}</h2><p className="review-to">To {current.name}{current.title ? ` · ${current.title}` : ""}{current.email ? ` · ${current.email}` : " · no address on file"}</p></div>
                  <span className={`dw-state ${dirty ? "is-dirty" : ""}`}>{dirty ? "Unsaved changes" : current.status === "approved" ? "Approved" : "Saved"}</span>
                </header>
                {current.linkedin && (
                  <div className="dw-channels" role="tablist" aria-label="Channel">
                    <button type="button" role="tab" aria-selected={channel === "email"} className={channel === "email" ? "is-on" : ""} onClick={() => setChannel("email")}>Email</button>
                    <button type="button" role="tab" aria-selected={channel === "linkedin"} className={channel === "linkedin" ? "is-on" : ""} onClick={() => setChannel("linkedin")}>LinkedIn (manual)</button>
                  </div>
                )}
                {channel === "linkedin" && current.linkedin
                  ? <div className="dw-linkedin">
                      <p className="dw-hint">LinkedIn goes out by hand: copy it, open the profile, send it there, then mark it sent under LinkedIn tasks.</p>
                      <div className="dw-linkedin-text">{current.linkedin}</div>
                      <div className="dw-row">
                        <button type="button" className="dw-btn is-ghost" onClick={() => { void navigator.clipboard?.writeText(current.linkedin ?? "").then(() => setCopied(true)); }}>{copied ? "Copied" : "Copy message"}</button>
                        {current.linkedinUrl && <a className="dw-btn is-ghost" href={current.linkedinUrl} target="_blank" rel="noreferrer">Open profile</a>}
                        <Link className="dw-link" href={`/linkedin?owner=${owner}`}>LinkedIn tasks <ArrowRight size={15} aria-hidden="true" /></Link>
                      </div>
                    </div>
                  : <>
                      <label className="dw-label"><span>Subject</span><input value={editing.subject} maxLength={120} disabled={!canAct} onChange={(event) => setEdit({ ...editing, subject: event.target.value })} /></label>
                      <label className="dw-label"><span>Email body</span><textarea rows={13} maxLength={1000} value={editing.body} disabled={!canAct} onChange={(event) => setEdit({ ...editing, body: event.target.value })} /></label>
                      {canAct && (
                        <div className="dw-suggest">
                          {SUGGEST.map((item) => <button key={item.key} type="button" className="dw-chip" disabled={busy !== null || dirty} title={dirty ? "Save your changes first" : undefined} onClick={() => void suggest(current, item.instruction, item.key)}><item.icon size={15} aria-hidden="true" />{busy === item.key ? "Working…" : item.label}</button>)}
                          <span className="dw-hint"><WarningCircle size={14} aria-hidden="true" />Suggestions need your review</span>
                        </div>
                      )}
                      <button type="button" className="dw-link review-as-sent" aria-expanded={preview} onClick={() => setPreview(!preview)}>{preview ? "Hide the preview" : "See it exactly as it will be sent"}</button>
                      {preview && <div className="review-email dw-preview" dangerouslySetInnerHTML={{ __html: emailHtml(current, editing.body) }} />}
                    </>}
                <footer className="dw-actions review-actions">
                  {canAct && (current.status === "approved"
                    ? <button type="button" className="dw-btn is-primary" disabled={busy !== null} onClick={() => void run([current], { status: "edited" }, "moved back to Needs review.")}>Move back to review</button>
                    : <button type="button" className="dw-btn is-primary" disabled={busy !== null || !current.sendable} onClick={() => void approve(current)}>{busy === "approve" ? "Saving…" : dirty ? "Save, approve & next" : "Approve & next"}<ArrowRight size={16} aria-hidden="true" /></button>)}
                  {canAct && dirty && <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => void save(current)}>Save</button>}
                  {canAct && <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => void run([current], { auto_send_hold: !current.held }, current.held ? "released to auto-send." : "held. Auto-send skips it.")}>{current.held ? "Release" : "Hold"}</button>}
                  <button type="button" className="dw-btn" disabled={busy !== null} onClick={() => after(current, new Set())}>Skip</button>
                  {canAct && <button type="button" className="dw-link is-bad" disabled={busy !== null} onClick={() => setConfirmDrop([current.id])}>Not a fit</button>}
                  <span className="dw-foot"><span>Approval does not send this email.</span><span>Draft {position} of {shown.length}</span></span>
                </footer>
              </article>
            )}

            {current && (
              <aside className="dw-research" aria-label="Why this company">
                <div className="dw-research-head"><h2>Why this company?</h2>{current.fit && <span className={`dw-fit is-${fitLabel(current.fit.score).toLowerCase()}`}>Fit: {fitLabel(current.fit.score)}</span>}</div>
                <section>
                  <h3>Company facts</h3>
                  <dl className="dw-facts">
                    <div><dt>Sector</dt><dd>{current.industry}</dd></div>
                    <div><dt>Revenue</dt><dd>{current.size}</dd></div>
                    <div><dt>Contact</dt><dd>{current.title || "Unknown title"}</dd></div>
                  </dl>
                </section>
                <section>
                  <h3>Potential opportunity</h3>
                  <p>{current.fit?.summary || current.trigger || "No research summary for this company yet."}</p>
                  {current.fit && current.fit.reasons.length > 0 && <ul className="dw-reasons">{current.fit.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
                  {current.fit && current.fit.concerns.length > 0 && <p className="dw-concern"><WarningCircle size={14} aria-hidden="true" />{current.fit.concerns.join(" ")}</p>}
                  <small className="dw-muted">From the research. Confirm in conversation.</small>
                </section>
                {current.sources.length > 0 && (
                  <section>
                    <h3>Research sources</h3>
                    <ul className="dw-sources">{current.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label} &#8599;</a></li>)}</ul>
                  </section>
                )}
                <section>
                  <h3>Contact history</h3>
                  <p>{current.history.sent ? `${plural(current.history.sent, "email", "emails")} sent before, last on ${shortDate(current.history.last ?? "")}.` : "No previous outreach recorded."}</p>
                </section>
                <section>
                  <h3>Send eligibility</h3>
                  <ul className="dw-checks">
                    <li className={current.confirmed ? "is-ok" : "is-warn"}>{current.confirmed ? "Verified email" : current.sendable ? "Address not confirmed yet" : "No email address yet"}</li>
                    <li className={current.held ? "is-warn" : "is-ok"}>{current.held ? "Held: auto-send skips it" : "Not held"}</li>
                    <li className={current.status === "approved" ? "is-ok" : "is-warn"}>{current.status === "approved" ? "Approved" : "Waiting for your approval"}</li>
                    <li className={current.slot && current.slot.position > 0 ? "is-ok" : "is-muted"}>{current.slot ? (current.slot.position > 0 ? `In the send queue, number ${current.slot.position}` : current.slot.label) : "Not in the send queue"}</li>
                  </ul>
                </section>
                <div className="dw-research-foot">
                  <Link className="dw-link" href={`/accounts/${encodeURIComponent(current.domain)}`}>View company <ArrowRight size={15} aria-hidden="true" /></Link>
                  <Link className="dw-link" href={`${listHref}&card=${current.id}`}>Open on the Reach-out list</Link>
                </div>
              </aside>
            )}
          </div>
        )}
      <p className="dw-keys">Keys: <kbd>J</kbd> <kbd>K</kbd> move, <kbd>A</kbd> approve &amp; next.</p>
    </section>
  );
}
