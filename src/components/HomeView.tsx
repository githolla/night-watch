"use client";

import Link from "next/link";
import { Bell, CalendarDays, Check, ChevronRight, CircleAlert, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { AddressFix } from "@/components/AddressFix";
import { FollowupQueue } from "@/components/FollowupQueue";
import { InlineConfirm } from "@/components/InlineConfirm";
import { setCardStatus } from "@/lib/card-status";
import type { HomeData } from "@/lib/home-view";
import { replyLabel } from "@/lib/reply-labels";
import type { ReplyItem } from "@/lib/replies-view";
import { batches, draftGroups, type DraftGroupKey, type NextUpLead, type SeriesDay } from "@/lib/home-stats";
import type { Owner } from "@/lib/types";

type Metric = "sent" | "replies" | "interested" | "bounced";
type Range = 7 | 14 | 30 | 90;

const RANGES: Range[] = [7, 14, 30, 90];
const METRICS: Array<{ key: Metric; label: string }> = [
  { key: "sent", label: "Sent" }, { key: "replies", label: "Replies" }, { key: "interested", label: "Interested" },
];

const sum = (days: SeriesDay[], key: Metric) => days.reduce((total, day) => total + day[key], 0);
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayLabel = (date: string, long = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", long ? { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" });


/** Sent emails as bars (first emails and follow-ups), with replies, interest or bounces drawn over them. Hover a day for its numbers. */
function ActivityChart({ days, metric }: { days: SeriesDay[]; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(1, ...days.map((day) => day.sent));
  const step = top <= 5 ? 1 : top <= 20 ? 5 : top <= 50 ? 10 : 20;
  const ceiling = Math.ceil(top / step) * step;
  const ticks = Array.from({ length: ceiling / step + 1 }, (_, index) => index * step).reverse();
  const shown = hover === null ? null : days[hover];
  const every = Math.ceil(days.length / 6);
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setHover(Math.min(days.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * days.length))));
  };
  return (
    <div className="hv-chart">
      <div className="hv-chart-y" aria-hidden="true">{ticks.map((tick) => <span key={tick}>{tick}</span>)}</div>
      <div className="hv-chart-plot" onPointerMove={pick} onPointerLeave={() => setHover(null)} role="img" aria-label={`Emails sent per day over the last ${days.length} days`}>
        <div className="hv-chart-grid" aria-hidden="true">{ticks.map((tick) => <i key={tick} />)}</div>
        <div className="hv-chart-bars">
          {days.map((day, index) => {
            const followups = day.sent - day.firsts;
            const over = metric === "sent" ? 0 : day[metric];
            return (
              <div key={day.date} className={`hv-col ${hover === index ? "is-hover" : ""} ${hover !== null && hover !== index ? "is-dim" : ""}`}>
                <div className="hv-bar" style={{ height: `${(day.sent / ceiling) * 100}%` }}>
                  {metric === "sent"
                    ? <><span className="is-follow" style={{ height: `${pct(followups, day.sent)}%` }} /><span className="is-first" style={{ height: `${pct(day.firsts, day.sent)}%` }} /></>
                    : <span className={`is-${metric}`} style={{ height: `${pct(over, day.sent)}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        {shown && hover !== null && (
          <div className={`hv-tip ${hover > days.length / 2 ? "is-left" : ""}`} style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}>
            <b>{dayLabel(shown.date, true)}</b>
            <span><i className="is-first" />{count(shown.firsts, "first email", "first emails")}</span>
            <span><i className="is-follow" />{count(shown.sent - shown.firsts, "follow-up", "follow-ups")}</span>
            <span><i className="is-replies" />{count(shown.replies, "reply", "replies")}</span>
            <span><i className="is-interested" />{shown.interested} interested</span>
            {shown.bounced > 0 && <span><i className="is-bounced" />{shown.bounced} bounced</span>}
          </div>
        )}
        <div className="hv-chart-x" aria-hidden="true">
          {days.map((day, index) => <span key={day.date}>{index % every === (days.length - 1) % every ? (index === days.length - 1 ? "Today" : dayLabel(day.date)) : ""}</span>)}
        </div>
      </div>
    </div>
  );
}

function Panel({ className, title, sub, link, side, children }: { className: string; title: string; sub?: string; link?: { href: string; label: string }; side?: ReactNode; children: ReactNode }) {
  return (
    <section className={`home-card ov-panel ${className}`} aria-label={title}>
      <div className="ov-panel-head"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>{side}{link && <More href={link.href}>{link.label}</More>}</div>
      {children}
    </section>
  );
}

const More = ({ href, children }: { href: string; children: ReactNode }) => <Link className="ov-more" href={href}>{children}<ChevronRight size={15} strokeWidth={2.2} aria-hidden="true" /></Link>;
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const where = (lead: NextUpLead) =>
  lead.group === "going" ? { tone: "ok", text: lead.time ? `About ${lead.time}` : "Next window" }
  : lead.group === "later" ? { tone: "muted", text: "A later window" }
  : lead.group === "held" ? { tone: "warn", text: lead.reason ?? "Held back" }
  : lead.group === "kept" ? { tone: "muted", text: "Kept for you" }
  : { tone: lead.reason === "Not in a window yet" ? "muted" : "warn", text: lead.reason ?? "Not queued" };

const PILES: Record<DraftGroupKey, { label: string; note: string | null }> = {
  next: { label: "Sends next", note: null },
  later: { label: "Later windows", note: null },
  checking: { label: "Checking address", note: "Nothing to do here: these send once their address is confirmed. Night Watch checks again every 20 minutes." },
  missing: { label: "No address yet", note: "Nothing to do here until an address turns up. Night Watch keeps looking." },
  held: { label: "Held or kept", note: "These won't send until what holds them changes. Open one to see why." },
};

type Patch = { auto_send_hold?: boolean; status?: string; email_subject?: string; email_body?: string };
const isReviewed = (lead: NextUpLead) => lead.status === "approved";
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * The drafts in piles and batches of ten. Read each email in place, fix it, tick it off, keep it back from
 * auto-send or drop it; select several to do any of that at once. Reviewed is the card's "approved" status,
 * the same mark the Drafts page sets, so it follows the seat to any browser.
 */
function DraftsReview({ queue, owner, sendWindow, cap, canAct }: { queue: NextUpLead[]; owner: Owner; sendWindow: string | null; cap: number; canAct: boolean }) {
  const router = useRouter();
  const [leads, setLeads] = useState(queue);
  // A refresh (after holding or releasing) brings a recounted queue; take it over the local copy.
  const [source, setSource] = useState(queue);
  if (source !== queue) { setSource(queue); setLeads(queue); }
  const groups = useMemo(() => draftGroups(leads), [leads]);
  const [pile, setPile] = useState<DraftGroupKey | null>(null);
  const [part, setPart] = useState(0);
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<string[] | null>(null);

  const group = groups.find((item) => item.key === pile) ?? groups.find((item) => item.leads.some((lead) => !isReviewed(lead))) ?? groups[0];
  const pileLeads = group?.leads ?? [];
  const sectors = [...new Set(pileLeads.map((lead) => lead.industry))].sort();
  const needle = query.trim().toLowerCase();
  const shown = pileLeads.filter((lead) => (sector === "all" || lead.industry === sector) && (!needle || `${lead.name} ${lead.company} ${lead.title}`.toLowerCase().includes(needle)));
  const parts = batches(shown);
  const at = Math.min(part, Math.max(0, parts.length - 1));
  const batch = parts[at] ?? [];
  const lead = batch.find((item) => item.id === picked) ?? batch.find((item) => !isReviewed(item)) ?? batch[0];
  const doneInPile = pileLeads.filter(isReviewed).length;
  const chosen = leads.filter((item) => selected.has(item.id));

  /** One PATCH through the same route and version check as the Drafts page; the local copy follows the saved one. */
  async function patch(target: NextUpLead, change: Patch): Promise<boolean> {
    const versioned = change.status !== undefined || change.email_body !== undefined || change.email_subject !== undefined;
    const response = await fetch(`/api/cards/${target.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...change, ...(versioned ? { expected_updated_at: target.updatedAt } : {}) }) }).catch(() => null);
    const json = await response?.json().catch(() => ({})) as { updated_at?: string; status?: string; email_subject?: string; email_body?: string; error?: string } | undefined;
    if (!response?.ok) {
      setNote({ text: response?.status === 409 ? `${target.name}: changed somewhere else or already sent. Reload to see the latest.` : `${target.name}: ${json?.error ?? "not saved, the connection dropped."}`, ok: false });
      return false;
    }
    setLeads((current) => current
      .filter((item) => !(item.id === target.id && change.status === "dismissed"))
      .map((item) => item.id !== target.id ? item : {
        ...item, status: json?.status ?? item.status, updatedAt: json?.updated_at ?? item.updatedAt, subject: json?.email_subject ?? item.subject, body: json?.email_body ?? item.body,
        ...(change.auto_send_hold === true ? { group: "kept" as const, position: 0, time: null } : {}),
        ...(change.auto_send_hold === false ? { group: "waiting" as const, reason: "Not in a window yet", position: 0, time: null } : {}),
      }));
    return true;
  }

  /** Runs one change over several drafts, one at a time, and says how it went. */
  async function run(targets: NextUpLead[], change: Patch, done: string) {
    setBusy(true);
    setNote(null);
    let ok = 0;
    for (const target of targets) if (await patch(target, change)) ok++;
    setBusy(false);
    setSelected(new Set());
    if (ok) setNote((current) => current && !current.ok && ok < targets.length ? current : { text: `${ok === 1 && targets.length === 1 ? targets[0].name : count(ok, "draft", "drafts")}: ${done}`, ok: true });
    // Holding or releasing changes the send queue, which only the server can recount.
    if (change.auto_send_hold !== undefined && ok) router.refresh();
  }

  function nextAfter(current: NextUpLead, done: (item: NextUpLead) => boolean) {
    const ahead = [...batch.slice(batch.indexOf(current) + 1), ...batch.slice(0, batch.indexOf(current))].find((item) => !done(item));
    if (ahead) { setPicked(ahead.id); return; }
    const later = parts.findIndex((items, index) => index > at && items.some((item) => !done(item)));
    if (later >= 0) { setPart(later); setPicked(null); }
  }

  async function looksGood(target: NextUpLead) {
    if (!canAct || isReviewed(target)) { nextAfter(target, isReviewed); return; }
    setBusy(true);
    const ok = await patch(target, { status: "approved" });
    setBusy(false);
    if (ok) nextAfter(target, (item) => item.id === target.id || isReviewed(item));
  }

  async function saveEdit(approve: boolean) {
    if (!editing || !lead) return;
    if (!editing.subject.trim() || !editing.body.trim()) { setNote({ text: "An email needs a subject and a message.", ok: false }); return; }
    setBusy(true);
    const ok = await patch(lead, { email_subject: editing.subject, email_body: editing.body, ...(approve ? { status: "approved" } : {}) });
    setBusy(false);
    if (!ok) return;
    setEditing(null);
    setNote({ text: approve ? "Saved and reviewed." : "Saved.", ok: true });
    if (approve) nextAfter(lead, (item) => item.id === lead.id || isReviewed(item));
  }

  const move = (step: number) => {
    if (!lead || !batch.length) return;
    const index = batch.indexOf(lead) + step;
    if (index >= 0 && index < batch.length) { setPicked(batch[index].id); setEditing(null); }
  };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  function onKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey || !lead) return;
    const key = event.key.toLowerCase();
    const act: Record<string, () => void> = {
      j: () => move(1), arrowdown: () => move(1), k: () => move(-1), arrowup: () => move(-1),
      a: () => void looksGood(lead), x: () => toggle(lead.id),
      e: () => canAct && setEditing({ id: lead.id, subject: lead.subject, body: lead.body }),
      h: () => canAct && void run([lead], { auto_send_hold: lead.group !== "kept" }, lead.group === "kept" ? "back in the queue." : "kept for you."),
    };
    if (act[key]) { event.preventDefault(); act[key](); }
  }

  if (!groups.length || !group) return <p className="ov-step-empty">No drafts waiting. New companies and drafts arrive with each weeknight&rsquo;s list. <More href="/targets">Find companies</More></p>;

  const sub = (key: DraftGroupKey) => key === "next" ? (sendWindow ?? "Next window") : key === "later" ? `Up to ${cap} a send day` : key === "checking" ? "Sends once confirmed" : key === "missing" ? "Still looking" : "Won't send yet";
  const choosePile = (key: DraftGroupKey) => { setPile(key); setPart(0); setPicked(null); setSector("all"); setQuery(""); setSelected(new Set()); setEditing(null); };
  const allInBatch = batch.length > 0 && batch.every((item) => selected.has(item.id));
  const kept = lead?.group === "kept";

  return (
    <div className="ov-review" onKeyDown={onKey}>
      <div className="ov-piles" role="tablist" aria-label="Piles">
        {groups.map((item) => {
          const done = item.leads.filter(isReviewed).length;
          return (
            <button key={item.key} type="button" role="tab" aria-selected={item.key === group.key} className={`ov-pile ${item.key === group.key ? "is-on" : ""}`} onClick={() => choosePile(item.key)}>
              <span className="ov-pile-top"><b>{item.leads.length}</b>{done > 0 && <small>{done === item.leads.length ? <Check size={13} strokeWidth={2.6} aria-label="All reviewed" /> : `${done} reviewed`}</small>}</span>
              <span className="ov-pile-label">{PILES[item.key].label}</span>
              <small>{sub(item.key)}</small>
            </button>
          );
        })}
      </div>

      {PILES[group.key].note && <p className="ov-step-hint">{PILES[group.key].note}</p>}

      <div className="ov-review-bar">
        <div className="ov-progress" aria-label={`${doneInPile} of ${pileLeads.length} reviewed`}>
          <span className="ov-progress-text"><b>{doneInPile}</b> of {pileLeads.length} reviewed</span>
          <span className="ov-progress-track"><span style={{ width: `${pct(doneInPile, pileLeads.length)}%` }} /></span>
        </div>
        <div className="ov-review-tools">
          {sectors.length > 1 && (
            <label className="ov-search is-select"><span className="sr-only">Sector</span>
              <select value={sector} onChange={(event) => { setSector(event.target.value); setPart(0); setPicked(null); }}>
                <option value="all">All sectors</option>
                {sectors.map((label) => <option key={label} value={label}>{label}</option>)}
              </select>
            </label>
          )}
          <label className="ov-search"><Search size={15} strokeWidth={2} aria-hidden="true" /><span className="sr-only">Find a person or company</span><input type="search" placeholder="Search" value={query} onChange={(event) => { setQuery(event.target.value); setPart(0); setPicked(null); }} /></label>
        </div>
      </div>

      {parts.length > 1 && (
        <div className="ov-batches" role="tablist" aria-label="Batches of ten">
          {parts.map((items, index) => {
            const all = items.every(isReviewed);
            return <button key={index} type="button" role="tab" aria-selected={index === at} className={`${index === at ? "is-on" : ""} ${all ? "is-done" : ""}`} onClick={() => { setPart(index); setPicked(null); setEditing(null); }}>{all && <Check size={13} strokeWidth={2.6} aria-hidden="true" />}{index * 10 + 1}&ndash;{index * 10 + items.length}</button>;
          })}
        </div>
      )}

      {canAct && (chosen.length > 0
        ? <div className="ov-bulk" role="toolbar" aria-label="Selected drafts">
            <b>{count(chosen.length, "draft", "drafts")} selected</b>
            <button type="button" className="ov-btn is-primary" disabled={busy} onClick={() => void run(chosen.filter((item) => !isReviewed(item)), { status: "approved" }, "marked reviewed.")}>Mark reviewed</button>
            <button type="button" className="ov-btn" disabled={busy} onClick={() => void run(chosen, { auto_send_hold: true }, "kept for you, auto-send skips them.")}>Keep for me</button>
            <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => setConfirmDrop(chosen.map((item) => item.id))}>Not a fit</button>
            <button type="button" className="ov-link" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        : <p className="ov-keys">Tick people to act on several at once. Keys: <kbd>J</kbd> <kbd>K</kbd> move, <kbd>A</kbd> looks good, <kbd>E</kbd> edit, <kbd>H</kbd> keep for me, <kbd>X</kbd> select.</p>)}

      {confirmDrop && (
        <InlineConfirm title={`Drop ${count(confirmDrop.length, "draft", "drafts")}?`} yes="Not a fit" busy={busy}
          onCancel={() => setConfirmDrop(null)}
          onYes={() => { const targets = leads.filter((item) => confirmDrop.includes(item.id)); setConfirmDrop(null); void run(targets, { status: "dismissed" }, "dropped as not a fit."); }}>
          They leave the list and won&rsquo;t be sent. Nothing already sent changes.
        </InlineConfirm>
      )}

      {note && <p className={`ov-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</p>}

      <div className="ov-next-body">
        <div className="ov-queue-wrap">
          {canAct && batch.length > 0 && (
            <label className="ov-select-all"><input type="checkbox" checked={allInBatch} onChange={() => setSelected((current) => { const next = new Set(current); for (const item of batch) { if (allInBatch) next.delete(item.id); else next.add(item.id); } return next; })} />Select these {batch.length}</label>
          )}
          <ul className="ov-queue" aria-label="This batch">
            {batch.map((item) => {
              const done = isReviewed(item);
              const state = where(item);
              return (
                <li key={item.id} className={selected.has(item.id) ? "is-picked" : ""}>
                  {canAct && <input type="checkbox" className="ov-check" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Select ${item.name}`} />}
                  <button type="button" className={`${item.id === lead?.id ? "is-on" : ""} ${done ? "is-done" : ""}`} aria-pressed={item.id === lead?.id} onClick={() => { setPicked(item.id); setEditing(null); }}>
                    <span className={`ov-avatar ${done ? "is-done" : ""}`} aria-hidden="true">{done ? <Check size={16} strokeWidth={2.6} /> : initials(item.name)}</span>
                    <span className="ov-queue-who"><b>{item.name}</b><small>{item.company}</small></span>
                    <span className={`ov-dot is-only is-${state.tone}`} title={state.text}><span className="sr-only">{state.text}</span></span>
                    <ChevronRight className="ov-queue-go" size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
            {!batch.length && <li className="ov-queue-none">Nobody matches. <button type="button" onClick={() => { setQuery(""); setSector("all"); }}>Show everyone</button></li>}
          </ul>
        </div>
        {lead && (
          <article className="ov-detail" aria-live="polite">
            <div className="ov-detail-who">
              <span className="ov-avatar is-big" aria-hidden="true">{initials(lead.name)}</span>
              <div>
                <h3>{lead.name}</h3>
                <p>{[lead.title, lead.company].filter(Boolean).join(" at ")}</p>
              </div>
            </div>
            <p className="ov-detail-meta">
              <span className={`ov-dot is-${where(lead).tone}`}>{where(lead).text}</span>
              <span>{lead.industry}</span><span>{lead.size}</span>
              <span className={lead.confirmed ? "is-ok" : "is-warn"}>{lead.confirmed ? <><Check size={14} strokeWidth={2.4} aria-hidden="true" />Verified address</> : <><CircleAlert size={14} strokeWidth={2.2} aria-hidden="true" />Address not confirmed</>}</span>
            </p>
            {editing?.id === lead.id
              ? <div className="ov-mail is-editing">
                  <label><span className="sr-only">Subject</span><input className="ov-mail-subject-input" value={editing.subject} onChange={(event) => setEditing({ ...editing, subject: event.target.value })} maxLength={120} /></label>
                  <label><span className="sr-only">Message</span><textarea className="ov-mail-body-input" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} maxLength={1000} rows={12} autoFocus /></label>
                </div>
              : <div className="ov-mail">
                  <p className="ov-mail-subject">{lead.subject || "(no subject)"}</p>
                  <div className="ov-mail-body">{lead.body || "This draft has no text yet."}</div>
                </div>}
            <div className="ov-detail-actions">
              {editing?.id === lead.id
                ? <>
                    <button type="button" className="ov-btn is-primary" disabled={busy} onClick={() => void saveEdit(true)}><Check size={16} strokeWidth={2.4} aria-hidden="true" />Save, looks good</button>
                    <button type="button" className="ov-btn" disabled={busy} onClick={() => void saveEdit(false)}>Save</button>
                    <button type="button" className="ov-link" onClick={() => setEditing(null)}>Cancel</button>
                  </>
                : <>
                    {isReviewed(lead)
                      ? <><span className="ov-dot is-ok">Reviewed</span>{canAct && <button type="button" className="ov-link" disabled={busy} onClick={() => void run([lead], { status: "edited" }, "back to not reviewed.")}>Undo</button>}</>
                      : <button type="button" className="ov-btn is-primary" disabled={busy || !canAct} onClick={() => void looksGood(lead)}><Check size={16} strokeWidth={2.4} aria-hidden="true" />Looks good, next</button>}
                    {canAct && <button type="button" className="ov-btn" disabled={busy} onClick={() => setEditing({ id: lead.id, subject: lead.subject, body: lead.body })}>Edit</button>}
                    {canAct && <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => void run([lead], { auto_send_hold: !kept }, kept ? "back in the queue." : "kept for you, auto-send skips it.")}>{kept ? "Back to the queue" : "Keep for me"}</button>}
                    {canAct && <button type="button" className="ov-link is-bad" disabled={busy} onClick={() => setConfirmDrop([lead.id])}>Not a fit</button>}
                    <Link className="ov-link" href={`/outreach?list=${owner}&card=${lead.id}`}>Full editor</Link>
                  </>}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

type Step = "replies" | "followups" | "fix" | "drafts";

const replyTone = (classification: string) => ["positive", "referral"].includes(classification) ? "ok" : classification === "objection" ? "warn" : "muted";
const ago = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3_600_000));
  return hours < 1 ? "Just now" : hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

/** One reply, ready to act on: what they wrote, the next step and the buttons that settle it. */
function ReplyCard({ item, nextStep, canAct, onDone }: { item: ReplyItem; nextStep: string; canAct: boolean; onDone: (cardId: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function move(status: "meeting" | "archived") {
    setBusy(true);
    setError(null);
    const result = await setCardStatus(item.cardId, status);
    setBusy(false);
    if (result.ok) onDone(item.cardId); else setError(result.error);
  }
  return (
    <li className="ov-reply">
      <div className="ov-reply-head">
        <span className="ov-avatar" aria-hidden="true">{initials(item.name)}</span>
        <span className="ov-queue-who"><b>{item.name}</b><small>{[item.title, item.company].filter(Boolean).join(" · ")}</small></span>
        <span className={`ov-dot is-${replyTone(item.classification)}`}>{replyLabel(item.classification)}</span>
        <span className="ov-reply-when">{ago(item.repliedAt)}</span>
      </div>
      {item.snippet ? <blockquote className="ov-reply-text">{item.snippet}</blockquote> : <p className="ov-reply-text is-missing">Open the thread in Gmail to read their reply.</p>}
      <p className="ov-reply-next"><span>Next step</span>{nextStep}</p>
      <div className="ov-reply-actions">
        {item.gmailUrl && <a className="ov-btn is-primary" href={item.gmailUrl} target="_blank" rel="noreferrer">Reply in Gmail</a>}
        <Link className="ov-btn" href={`/brief/${item.cardId}`}>Call brief</Link>
        {canAct && <>
          <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => void move("meeting")}>Meeting booked</button>
          <button type="button" className="ov-btn is-quiet" disabled={busy} onClick={() => void move("archived")}>Close</button>
        </>}
      </div>
      {error && <p className="ov-error" role="alert">{error}</p>}
    </li>
  );
}

/** The morning in order: answer replies, send the follow-ups that wait on you, fix bounced addresses, then review drafts. */
function YourDay({ data, owner, nextStep, canAct, canSend, sendWindow }: { data: HomeData; owner: Owner; nextStep: Record<string, string>; canAct: boolean; canSend: boolean; sendWindow: string | null }) {
  const [replies, setReplies] = useState(data.replies);
  const [settled, setSettled] = useState(0);
  const sendingNext = data.queue.filter((lead) => lead.group === "going").length;
  const steps: Array<{ key: Step; label: string; count: number; done: string; todo: string }> = [
    { key: "replies", label: "Replies", count: replies.length, done: settled ? `${settled} settled` : "None waiting", todo: `${replies.length} to answer` },
    { key: "followups", label: "Follow-ups", count: data.followups.length, done: "None due", todo: `${data.followups.length} to send` },
    { key: "fix", label: "Addresses", count: data.bounces.length, done: "None bounced", todo: `${data.bounces.length} to fix` },
    { key: "drafts", label: "Drafts", count: data.queue.length, done: "None waiting", todo: sendingNext ? `${sendingNext} send next` : `${data.queue.length} waiting` },
  ];
  const first = steps.find((step) => step.count > 0 && step.key !== "drafts")?.key ?? "drafts";
  const [open, setOpen] = useState<Step>(first);
  const q = `owner=${owner}`;
  // A settled reply leaves the list; when the last one goes, move on to the next step with work in it.
  const settle = (cardId: string) => {
    const left = replies.filter((row) => row.cardId !== cardId);
    setReplies(left);
    setSettled((n) => n + 1);
    if (!left.length) setOpen(steps.find((step) => step.key !== "replies" && step.count > 0)?.key ?? "drafts");
  };

  return (
    <section className="home-card ov-panel ov-day home-needs" aria-label="Your day">
      <div className="ov-panel-head"><div><h2>Your day</h2><p>Work down the steps. Each one opens right here.</p></div></div>
      <div className="ov-steps" role="tablist" aria-label="Steps">
        {steps.map((step, index) => {
          const clear = step.count === 0;
          return (
            <button key={step.key} type="button" role="tab" data-step={step.key} aria-selected={open === step.key} className={`ov-step ${open === step.key ? "is-on" : ""} ${clear ? "is-clear" : ""}`} onClick={() => setOpen(step.key)}>
              <span className="ov-step-num" aria-hidden="true">{clear ? <Check size={14} strokeWidth={2.6} /> : index + 1}</span>
              <span className="ov-step-text"><b>{step.label}</b><small>{clear ? step.done : step.todo}</small></span>
            </button>
          );
        })}
      </div>

      <div className="ov-step-body" role="tabpanel">
        {open === "replies" && (replies.length
          ? <ul className="ov-replies">{replies.map((item) => <ReplyCard key={item.cardId} item={item} canAct={canAct} nextStep={nextStep[item.classification] ?? "Read it and reply from your Gmail thread."} onDone={settle} />)}</ul>
          : <p className="ov-step-empty">No replies need a response. New ones land here and in your inbox. <More href={`/replies?${q}`}>All replies</More></p>)}

        {open === "followups" && (data.followups.length
          ? <><p className="ov-step-hint">These came due but couldn&rsquo;t go out by themselves, usually because the address isn&rsquo;t confirmed. Open one to send, change or skip it.</p><FollowupQueue items={data.followups.map((item) => ({ ...item, canAct, canSend }))} sent={false} /></>
          : <p className="ov-step-empty">Nothing due. Follow-ups go out by themselves 3 and 10 business days after each first email. <More href={`/followups?view=upcoming&${q}`}>Coming up</More></p>)}

        {open === "fix" && (data.bounces.length
          ? <ul className="ov-prio">{data.bounces.map((bounce) => (
              <li key={bounce.personId}>
                <span className="ov-glyph is-bad" aria-hidden="true"><CircleAlert size={18} strokeWidth={2} /></span>
                <span className="ov-prio-text"><b>{bounce.name} bounced</b><small>{bounce.company}{bounce.email ? ` · ${bounce.email}` : ""}</small></span>
                <span className="ov-act"><AddressFix personId={bounce.personId} current={bounce.email} label="Fix address" /></span>
              </li>
            ))}</ul>
          : <p className="ov-step-empty">No bounced addresses in the last 30 days.</p>)}

        {open === "drafts" && <DraftsReview queue={data.queue} owner={owner} sendWindow={sendWindow} cap={data.autoSend?.plan.dailyCap ?? 40} canAct={canAct} />}
      </div>
    </section>
  );
}

/** Overview: the day's work in order, the sending status in one line, then how it is going. */
export function HomeView({ data, owner, hello, aside, nextStep, canAct, canSend }: { data: HomeData; owner: Owner; hello: string; aside?: ReactNode; nextStep: Record<string, string>; canAct: boolean; canSend: boolean }) {
  const q = `owner=${owner}`;
  const auto = data.autoSend;
  const [range, setRange] = useState<Range>(14);
  const [metric, setMetric] = useState<Metric>("sent");

  const current = useMemo(() => data.series.slice(-range), [data.series, range]);
  const totals = { sent: sum(current, "sent"), replies: sum(current, "replies"), interested: sum(current, "interested"), bounced: sum(current, "bounced") };
  const firsts = current.reduce((total, day) => total + day.firsts, 0);
  const last7 = data.series.slice(-7);
  const weekSent = sum(last7, "sent");
  const weekBounceRate = pct(sum(last7, "bounced"), weekSent);

  const on = Boolean(auto && !auto.plan.blocker);
  const autoState = auto?.control.paused ? "Auto-send paused" : on ? (auto?.control.skippedToday ? "Auto-send skipped today" : "Auto-send on") : "Auto-send off";
  const sendWindow = auto ? `${auto.plan.dayLabel.charAt(0).toUpperCase() + auto.plan.dayLabel.slice(1)}, ${auto.plan.windowLabel} ET` : null;
  const warnings = [
    !data.gmailConnected && { text: "Gmail is not connected, so nothing can be sent.", href: "/settings", action: "Connect Gmail" },
    auto?.control.paused && { text: `Auto-send is paused${auto.control.pausedReason ? `: ${auto.control.pausedReason.replace(/\.\s*$/, "")}` : ""}.`, href: `/auto-send?${q}`, action: "Review and resume" },
    weekSent >= 5 && weekBounceRate >= 5 && { text: `${weekBounceRate}% of this week's emails bounced. Fix the addresses under Your day before sending more.`, href: `/drafts/sent?${q}&days=7`, action: "See them" },
  ].filter((item): item is { text: string; href: string; action: string } => Boolean(item));

  const sendingNext = data.queue.filter((lead) => lead.group === "going").length;
  const todo = [
    data.replies.length && count(data.replies.length, "reply", "replies") + " to answer",
    data.followups.length && count(data.followups.length, "follow-up", "follow-ups") + " to send",
    data.bounces.length && count(data.bounces.length, "address", "addresses") + " to fix",
    data.queue.length && (sendingNext ? `${count(sendingNext, "draft", "drafts")} sending next to review` : count(data.queue.length, "draft", "drafts") + " waiting"),
  ].filter((part): part is string => Boolean(part));
  const summary = todo.length ? `Today: ${todo.length > 1 ? `${todo.slice(0, -1).join(", ")} and ${todo.at(-1)}` : todo[0]}.` : "You are all caught up.";

  const kpis = [
    { label: "Emails sent", value: String(totals.sent), sub: count(totals.sent - firsts, "follow-up", "follow-ups") },
    { label: "Reply rate", value: `${pct(totals.replies, totals.sent)}%`, sub: count(totals.replies, "reply", "replies") },
    { label: "Interested", value: String(totals.interested), sub: "positive or a referral" },
    { label: "Meetings booked", value: String(data.funnel?.meetings ?? 0), sub: "on the calendar now" },
    { label: "Bounce rate", value: `${pct(totals.bounced, totals.sent)}%`, sub: count(totals.bounced, "bounce", "bounces") },
  ];
  const funnelSteps = data.funnel ? [
    { label: "Emailed", value: data.funnel.emailed },
    { label: "Replied", value: data.funnel.replied },
    { label: "Interested", value: data.funnel.interested },
    { label: "Meeting booked", value: data.funnel.meetings },
  ] : [];

  return (
    <div className="home ov">
      <header className="ov-top page-top">
        <nav className="ov-crumbs" aria-label="Where you are"><span>Workspace</span><span aria-hidden="true">/</span><b>Overview</b></nav>
        <div className="ov-top-side">
          {aside}
          <Link className={`ov-bell ${data.replies.length ? "has-dot" : ""}`} href={`/replies?${q}`} title={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "No replies waiting"} aria-label={data.replies.length ? `${count(data.replies.length, "reply", "replies")} waiting` : "Replies"}><Bell size={19} strokeWidth={1.8} /></Link>
        </div>
      </header>

      <div className="ov-hello">
        <div>
          <h1>{hello}, {data.first}.</h1>
          <p>{summary}</p>
        </div>
        <Link className="ov-btn" href="/targets">Find companies</Link>
      </div>

      <div className="home-auto ov-status" aria-label="Sending">
        <span className={`ov-dot is-${auto?.control.paused ? "bad" : on ? "ok" : "warn"}`}>{autoState}</span>
        {sendWindow && <span>Next window <b>{sendWindow}</b></span>}
        {auto && <span><b>{auto.plan.sentToday}</b> of {auto.plan.dailyCap} sent today</span>}
        {on && auto && <span><b>{auto.plan.going}</b> going next</span>}
        <More href={`/auto-send?${q}`}>Manage</More>
      </div>

      {warnings.map((warning) => <p key={warning.text} className="home-warning" role="alert"><span>{warning.text}</span><Link href={warning.href}>{warning.action} &rarr;</Link></p>)}

      <YourDay data={data} owner={owner} nextStep={nextStep} canAct={canAct} canSend={canSend} sendWindow={sendWindow} />

      <h2 className="ov-section">How it&rsquo;s going</h2>
      <section className="ov-kpis" aria-label="Headline numbers">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="ov-kpi">
            <span className="ov-kpi-label">{kpi.label}</span>
            <span className="ov-kpi-value"><b>{kpi.value}</b></span>
            <small>{kpi.sub}</small>
          </div>
        ))}
      </section>

      <div className="ov-grid is-main">
        <Panel className="home-week ov-activity" title="Outreach activity" side={
          <label className="ov-range">
            <CalendarDays size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="sr-only">Period</span>
            <select value={range} onChange={(event) => setRange(Number(event.target.value) as Range)}>
              {RANGES.map((value) => <option key={value} value={value}>Last {value} days</option>)}
            </select>
          </label>
        }>
          <div className="ov-seg is-small" role="tablist" aria-label="Show on the chart">
            {METRICS.map((item) => <button key={item.key} type="button" role="tab" aria-selected={metric === item.key} className={metric === item.key ? "is-on" : ""} onClick={() => setMetric(item.key)}>{item.label}</button>)}
          </div>
          {data.series.length ? <ActivityChart days={current} metric={metric} /> : <p className="home-empty">Sent emails show here once the first ones go out.</p>}
        </Panel>

        <Panel className="ov-pipeline" title="Conversation pipeline" sub="First-touch contacts · last 90 days" link={{ href: "/pipeline", label: "Open" }}>
          <ol className="hv-steps">
            {funnelSteps.map((step) => (
              <li key={step.label}>
                <div className="hv-step-top"><span>{step.label}</span><b>{step.value}</b></div>
                <div className="hv-step-bar"><span style={{ width: `${Math.max(pct(step.value, Math.max(1, funnelSteps[0].value)), step.value ? 3 : 0)}%` }} /></div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
}
