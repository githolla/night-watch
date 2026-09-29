"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useRef } from "react";

export type FollowupItem = {
  id: string;
  status: string;
  error: string | null;
  claimed: boolean;
  owner: string;
  cadenceStatus?:string;
  manualPending?:boolean;
  canSend: boolean;
  cardId: string;
  step: number;
  channel: string;
  title: string;
  detail: string;
  subject: string | null;
  body: string;
  scheduledAt: string;
  due: boolean;
  person: string;
  personTitle: string;
  company: string;
  domain: string;
};

const channelKind = (channel: string) => (channel === "email" ? "email" : "linkedin");
const channelLabel = (channel: string) => (channel === "email" ? "Email" : "LinkedIn");
function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}
function whenLabel(iso: string, now: number) {
  const days = Math.round((Date.parse(iso) - now) / 86_400_000);
  if (days <= 0) return "due now";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Follow-ups queued after the first touch: what to send next, on the day it comes due, one click to copy and log. */
export function FollowupsBoard({ items }: { items: FollowupItem[] }) {
  const [list, setList] = useState(items);
  const [source,setSource]=useState(items);
  if(source!==items){setSource(items);setList(items);}
  const [now] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending,setPending]=useState<Set<string>>(new Set());
  const inFlight=useRef(new Set<string>()),router=useRouter();
  function begin(id:string){if(inFlight.current.has(id))return false;inFlight.current.add(id);setPending(new Set(inFlight.current));return true;}
  function finish(id:string){inFlight.current.delete(id);setPending(new Set(inFlight.current));router.refresh();}

  const due = useMemo(() => list.filter((item) => item.due && item.status !== "sent"), [list]);
  const upcoming = useMemo(() => list.filter((item) => !item.due && item.status !== "sent"), [list]);

  async function act(id: string, action: "sent" | "skipped") {
    if(!begin(id))return;
    try {
      const response = await fetch(`/api/cadence-steps/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      const json = await response.json();
      if (!response.ok) { setNotice(json.error ?? "Could not update the follow-up."); return; }
      setList((current) => current.filter((item) => item.id !== id));
      setNotice(action === "sent" ? "Marked sent — logged to the history." : "Skipped.");
    } catch { setNotice("Could not update the follow-up."); }
    finally { finish(id); }
  }
  async function send(item: FollowupItem) {
    if(!begin(item.id))return;
    try {
      const response = await fetch(`/api/cadence-steps/${item.id}/send-now`, {method:'POST'});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not send the follow-up.');
      setList(current => current.filter(row => result.stopped ? row.cardId!==item.cardId : row.id !== item.id));
      setNotice(result.stopped ? 'A reply was found. This sequence has been stopped.' : result.warning || 'Gmail confirmed the follow-up was sent.');
    } catch(error) {setList(current=>current.map(row=>row.id===item.id?{...row,claimed:true,error:'Check delivery before retrying.'}:row));setNotice(error instanceof Error ? error.message : 'Delivery status unavailable. Check Gmail Sent before trying again.');}
    finally {finish(item.id);}
  }
  async function copy(item: FollowupItem) {
    const text = item.subject ? `Subject: ${item.subject}\n\n${item.body}` : item.body;
    try { await navigator.clipboard.writeText(text); setCopied(item.id); setTimeout(() => setCopied((value) => (value === item.id ? null : value)), 1400); }
    catch { setNotice("Copy was blocked — select the text to copy it."); }
  }

  function render(item: FollowupItem) {
    return (
      <article key={item.id} className="followup">
        <div className="followup-top">
          <span className="avatar sm">{initials(item.person)}</span>
          <div className="followup-id">
            <strong>{item.person}</strong>
            <small>{item.personTitle ? `${item.personTitle} · ` : ""}<Link href={`/accounts/${item.domain}`} className="people-company">{item.company}</Link></small>
          </div>
          <div className="followup-meta">
            <em className={`activity-chan k-${channelKind(item.channel)}`}>{channelLabel(item.channel)}</em>
            <span className={`followup-when ${item.due ? "is-due" : ""}`}>Step {item.step} · {whenLabel(item.scheduledAt, now)}</span>
          </div>
        </div>
        <p><strong>{item.manualPending ? "Finish saving manual activity" : item.claimed ? "Needs delivery confirmation" : item.status}</strong> · {item.owner === "jenna" ? "Suuchi" : "Josh"}{item.cadenceStatus&&item.cadenceStatus!=='active'&&<> · Sequence {item.cadenceStatus}</>}{item.error && <><br />{item.error}</>}</p>
        <div className="followup-title">{item.title}<small>{item.detail}</small></div>
        <div className="followup-draft">
          {item.subject && <div className="mail-row"><span>Subject</span><b>{item.subject}</b></div>}
          <p className="followup-body">{item.body}</p>
        </div>
        <div className="followup-actions">
          <button type="button" className="btn" onClick={() => copy(item)}>{copied === item.id ? "Copied ✓" : "Copy"}</button>
          {item.channel === "email" && <button className="btn primary" disabled={pending.has(item.id) || !item.canSend || item.claimed || item.status === "sent"} onClick={() => send(item)}>Send follow-up</button>}
          {item.claimed && !item.manualPending ? <Link className="btn" href="/delivery-recovery">Check delivery</Link> : <button type="button" className="btn" disabled={pending.has(item.id) || !item.canSend || item.status === "sent"} onClick={() => act(item.id, "sent")}>{item.manualPending?'Finish saving history':'Already sent manually'}</button>}
          <button type="button" className="btn ghost" disabled={pending.has(item.id) || !item.canSend || item.claimed || item.status === "sent"} onClick={() => act(item.id, "skipped")}>Skip</button>
        </div>
      </article>
    );
  }

  return <>
    <header className="page-head briefing-head">
      <div><span className="overview-kick">Cadence</span><h1>Follow-ups</h1><p>The next steps queued after a first touch. Each one comes due on its day — copy it, send, and it&apos;s logged. {due.length} due now · {upcoming.length} coming up.</p></div>
    </header>

    {notice && <p className="notice">{notice}</p>}

    {list.some(item => item.status === "sent") && <details><summary>Sent follow-ups</summary>{list.filter(item => item.status === "sent").map(render)}</details>}

    {list.length === 0 && <section className="card"><p className="cell-empty">No follow-ups queued. Copy or send a first email or LinkedIn message from the desk and Night Watch lines up the next three here.</p></section>}

    {due.length > 0 && <section className="followup-group">
      <h2 className="followup-group-head">Due now <b>{due.length}</b></h2>
      <div className="followup-list">{due.map(render)}</div>
    </section>}

    {upcoming.length > 0 && <section className="followup-group">
      <h2 className="followup-group-head">Coming up <b>{upcoming.length}</b></h2>
      <div className="followup-list">{upcoming.map(render)}</div>
    </section>}
  </>;
}
