"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type ActivityEvent = {
  id: string;
  at: string;
  day: string; // YYYY-MM-DD
  channel: string;
  owner: string;
  sentBy: string;
  person: string;
  title: string;
  company: string;
  to: string | null;
  subject: string | null;
  body: string;
  snippet: string;
  replied: boolean;
  replyClass: string;
  inCadence: boolean;
  gmailThreadId: string | null;
  version?: string;
  openAt?: string | null;
  giftViewAt?: string | null;
  trackedOpen?: boolean;
  sendSource?: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  linkedin_message: "LinkedIn message",
  linkedin_comment: "LinkedIn reply",
  linkedin_request: "LinkedIn request",
  intro_ask: "Intro",
};
const channelKind = (channel: string) => (channel === "email" ? "email" : channel === "intro_ask" ? "intro" : "linkedin");
type Filter = "all" | "email" | "linkedin" | "sent" | "replied" | "cadence";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "All" },
  { key: "email", label: "Email" },
  { key: "linkedin", label: "LinkedIn" },
  { key: "sent", label: "Sent" },
  { key: "replied", label: "Replied" },
  { key: "cadence", label: "In cadence" },
];
function matchFilter(event: ActivityEvent, filter: Filter): boolean {
  switch (filter) {
    case "email": return channelKind(event.channel) === "email";
    case "linkedin": return channelKind(event.channel) === "linkedin";
    case "sent": return !event.replied;
    case "replied": return event.replied;
    case "cadence": return event.inCadence;
    default: return true;
  }
}
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const dayLong = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const fullWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";

/** History of every outreach touch — a month calendar of what was done, and the day-by-day record beneath it. */
export function ActivityView({ events: initialEvents, who, note, canDelete }: { events: ActivityEvent[]; who?: { name: string } | null; note?: string | null; canDelete?: boolean }) {
  const [events, setEvents] = useState(initialEvents);
  const [detail, setDetail] = useState<ActivityEvent | null>(null);
  const [fetched, setFetched] = useState<{ id: string; body: string } | null>(null);
  // A send only logged as a snippet (composed directly in Gmail) needs its full body pulled back
  // from Gmail so the reader shows the entire email; a normal send already carries its full body.
  const needsFetch = Boolean(detail && detail.channel === "email" && detail.gmailThreadId && (!detail.body || detail.body.startsWith("(sent from Gmail)")));
  const loadingBody = Boolean(needsFetch && detail && fetched?.id !== detail.id);
  useEffect(() => {
    if (!detail || !needsFetch || fetched?.id === detail.id) return;
    const id = detail.id;
    let live = true;
    fetch(`/api/touches/${id}/message`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && typeof j?.body === "string") setFetched({ id, body: j.body }); })
      .catch(() => {});
    return () => { live = false; };
  }, [detail, needsFetch, fetched]);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  async function syncGmail() {
    setSyncing(true); setSyncMsg("");
    try {
      const res = await fetch("/api/admin/sent-sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) { setSyncMsg(json.error ?? "Sync failed."); return; }
      setSyncMsg(json.logged > 0 ? `Added ${json.logged} email${json.logged === 1 ? "" : "s"} from Gmail — reloading…` : "No new Gmail sends to add (scanned recent Sent).");
      if (json.logged > 0) setTimeout(() => location.reload(), 900);
    } catch { setSyncMsg("Sync failed."); }
    finally { setSyncing(false); }
  }
  async function removeEvent(id: string) {
    if (!confirm("Remove this record? It was never actually sent, or is a duplicate.")) return;
    const res = await fetch(`/api/touches/${id}`, { method: "DELETE" });
    if (res.ok) setEvents((current) => current.filter((event) => event.id !== id));
  }
  const [filter, setFilter] = useState<Filter>("all");
  const view = useMemo(() => (filter === "all" ? events : events.filter((event) => matchFilter(event, filter))), [events, filter]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: events.length, email: 0, linkedin: 0, sent: 0, replied: 0, cadence: 0 };
    for (const event of events) {
      if (channelKind(event.channel) === "email") c.email++;
      else if (channelKind(event.channel) === "linkedin") c.linkedin++;
      if (event.replied) c.replied++; else c.sent++;
      if (event.inCadence) c.cadence++;
    }
    return c;
  }, [events]);

  const byDay = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const event of view) (map.get(event.day) ?? map.set(event.day, []).get(event.day)!).push(event);
    return map;
  }, [view]);

  // Always open on the current month so "today" is in view; you can page back to older months.
  const [cursor, setCursor] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const monthEvents = useMemo(() => view.filter((event) => event.day.startsWith(monthKey)), [view, monthKey]);
  const shown = useMemo(() => (selectedDay ? byDay.get(selectedDay) ?? [] : monthEvents), [selectedDay, byDay, monthEvents]);

  // Build the calendar grid (Monday-first) for the cursor month.
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstWeekday = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7 !== 0) cells.push(null);

  // Totals count the whole month, not the current filter, so the tiles always show both channels.
  const monthAll = useMemo(() => events.filter((event) => event.day.startsWith(monthKey)), [events, monthKey]);
  const totals = useMemo(() => {
    let email = 0, linkedin = 0, replies = 0;
    for (const event of monthAll) {
      if (channelKind(event.channel) === "email") email++;
      else if (channelKind(event.channel) === "linkedin") linkedin++;
      if (event.replied) replies++;
    }
    return { email, linkedin, replies, total: monthAll.length };
  }, [monthAll]);
  const toggleFilter = (next: Filter) => setFilter((current) => (current === next ? "all" : next));

  const groups = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const event of shown) (map.get(event.day) ?? map.set(event.day, []).get(event.day)!).push(event);
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [shown]);

  const step = (delta: number) => { setSelectedDay(null); setCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1)); };
  const maxDay = Math.max(1, ...cells.filter(Boolean).map((day) => (byDay.get(day!)?.length ?? 0)));

  return (
    <main className="pipeline pipeline-work">
      <div className="activity">
        <header className="activity-head">
          <div>
            <span className="overview-kick">Outreach history</span>
            <h1>{who ? `Everything sent to ${who.name}.` : "What was sent, day by day."}</h1>
            {who && <Link href="/activity" className="activity-back">← All activity</Link>}
          </div>
          <div className="activity-totals">
            <button type="button" className={`activity-stat is-filter ${filter === "email" ? "is-on" : ""}`} onClick={() => toggleFilter("email")} title="Show only emails"><strong>{totals.email}</strong><span>✉ Emails</span></button>
            <button type="button" className={`activity-stat is-filter ${filter === "linkedin" ? "is-on" : ""}`} onClick={() => toggleFilter("linkedin")} title="Show only LinkedIn"><strong>{totals.linkedin}</strong><span>in LinkedIn</span></button>
            <button type="button" className={`activity-stat is-reply is-filter ${filter === "replied" ? "is-on" : ""}`} onClick={() => toggleFilter("replied")} title="Show only replied"><strong>{totals.replies}</strong><span>Replies</span></button>
            {canDelete && <button type="button" className="activity-sync" onClick={syncGmail} disabled={syncing} title="Pull emails sent directly from Gmail into History">{syncing ? "Syncing…" : "Sync Gmail sent"}</button>}
          </div>
        </header>

        <div className="activity-filters" role="tablist" aria-label="Filter history">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} className={`activity-filter ${filter === f.key ? "is-on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}<em>{counts[f.key]}</em>
            </button>
          ))}
        </div>

        {syncMsg && <p className="notice" role="status" style={{ marginBottom: 12 }}>{syncMsg}</p>}
        {note && <p className="notice" role="status" style={{ marginBottom: 16 }}>{note}</p>}

        {who ? (
          <section className="ptl">
            <div className="ptl-head">{view.length} {view.length === 1 ? "message" : "messages"} to {who.name}</div>
            {view.length === 0 && <p className="activity-empty">No emails or messages recorded for {who.name} yet.</p>}
            {view.map((event) => (
              <div key={event.id} className="ptl-item is-open" role="button" tabIndex={0} onClick={() => setDetail(event)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(event); } }} title="Open this message">
                <span className={`ptl-icon k-${channelKind(event.channel)}`}>{channelKind(event.channel) === "email" ? "✉" : channelKind(event.channel) === "linkedin" ? "in" : "•"}</span>
                <div className="ptl-main">
                  <div className="ptl-top">
                    <strong>{event.subject || CHANNEL_LABEL[event.channel] || "Message"}</strong>
                    <time>{fullWhen(event.at)}</time>
                  </div>
                  <div className="ptl-meta"><span>{CHANNEL_LABEL[event.channel] ?? event.channel}</span>{event.company ? <span>{event.company}</span> : null}<span>Sent by {event.sentBy}</span>{event.replied ? <em className={`activity-reply ${event.replyClass === "positive" ? "is-pos" : ""}`}>Replied</em> : null}</div>
                  {event.version && <p className="ptl-meta">{event.version} · {event.sendSource}{event.openAt ? " · Open detected" : ""}{event.giftViewAt ? " · Gift viewed" : ""}</p>}
                  {event.snippet && <p className="ptl-snip">{event.snippet}</p>}
                  <span className="ptl-open-hint">Open ↗</span>
                </div>
                {canDelete && <button type="button" className="activity-row-del" title="Remove this record" onClick={(e) => { e.stopPropagation(); removeEvent(event.id); }}>✕</button>}
              </div>
            ))}
          </section>
        ) : (
        <div className="activity-grid">
          <section className="activity-cal">
            <div className="activity-cal-head">
              <button type="button" onClick={() => step(-1)} aria-label="Previous month"><ChevronLeft size={16} /></button>
              <strong>{monthName(cursor)}</strong>
              <button type="button" onClick={() => step(1)} aria-label="Next month"><ChevronRight size={16} /></button>
            </div>
            <div className="activity-cal-week">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="activity-cal-days">
              {cells.map((day, index) => {
                if (!day) return <span key={`x${index}`} className="activity-cell is-empty" />;
                const count = byDay.get(day)?.length ?? 0;
                const level = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxDay) * 4));
                return (
                  <button
                    key={day}
                    type="button"
                    className={`activity-cell l${level} ${selectedDay === day ? "is-active" : ""} ${count ? "" : "is-quiet"}`}
                    onClick={() => setSelectedDay((current) => (current === day ? null : day))}
                    title={count ? `${count} on ${dayLong(day)}` : dayLong(day)}
                  >
                    <b>{Number(day.slice(-2))}</b>
                    {count > 0 && <em>{count}</em>}
                  </button>
                );
              })}
            </div>
            {selectedDay
              ? <button type="button" className="activity-clear" onClick={() => setSelectedDay(null)}>Show the whole month</button>
              : <p className="activity-cal-note">Click a day to see just that day.</p>}
          </section>

          <section className="activity-log">
            <div className="activity-log-head">{selectedDay ? dayLong(selectedDay) : `${monthName(cursor)} · ${monthEvents.length} ${monthEvents.length === 1 ? "touch" : "touches"}`}</div>
            {groups.length === 0 && <p className="activity-empty">Nothing recorded {selectedDay ? "on this day" : "this month"} yet. Sends, copies and LinkedIn opens land here as you work the desk.</p>}
            {groups.map(([day, list]) => (
              <div key={day} className="activity-day">
                {!selectedDay && <div className="activity-day-label">{dayLong(day)}<span>{list.length}</span></div>}
                {list.map((event) => (
                  <div key={event.id} className="activity-row is-open" role="button" tabIndex={0} onClick={() => setDetail(event)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(event); } }} title="Open this message">
                    <span className="avatar sm">{initials(event.person)}</span>
                    <div className="activity-row-main">
                      <div className="activity-row-top">
                        <strong>{event.person}</strong>
                        <em className={`activity-chan k-${channelKind(event.channel)}`}>{channelKind(event.channel) === "email" ? "✉" : channelKind(event.channel) === "linkedin" ? "in" : "•"} {CHANNEL_LABEL[event.channel] ?? event.channel}</em>
                        {event.replied && <em className={`activity-reply ${event.replyClass === "positive" ? "is-pos" : ""}`}>Replied</em>}
                      </div>
                      <small className="activity-row-sub">{event.title ? `${event.title} · ` : ""}{event.company} · Sent by {event.sentBy}</small>
                      {event.version && <small>{event.version} · {event.sendSource}{event.openAt ? " · Open detected" : ""}{event.giftViewAt ? " · Gift viewed" : ""}</small>}
                      {event.subject && <p className="activity-row-subject">{event.subject}</p>}
                      {event.snippet && <p className="activity-row-snip">{event.snippet}</p>}
                    </div>
                    <time className="activity-row-time">{timeOf(event.at)}</time>
                    {canDelete && <button type="button" className="activity-row-del" title="Remove this record" onClick={(e) => { e.stopPropagation(); removeEvent(event.id); }}>✕</button>}
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
        )}
      </div>

      {detail && (
        <div className="act-modal-back" role="dialog" aria-modal="true" onClick={() => setDetail(null)}>
          <div className="act-modal" onClick={(e) => e.stopPropagation()}>
            <header className="act-modal-head">
              <div>
                <span className={`act-modal-chan k-${channelKind(detail.channel)}`}>{channelKind(detail.channel) === "email" ? "✉ Email" : channelKind(detail.channel) === "linkedin" ? "in LinkedIn" : CHANNEL_LABEL[detail.channel] ?? detail.channel}</span>
                <h2>{detail.subject || CHANNEL_LABEL[detail.channel] || "Message"}</h2>
              </div>
              <button type="button" className="act-modal-x" onClick={() => setDetail(null)} aria-label="Close">✕</button>
            </header>
            <dl className="act-modal-meta">
              <div><dt>To</dt><dd>{detail.person}{detail.title ? `, ${detail.title}` : ""}{detail.to ? ` · ${detail.to}` : ""}</dd></div>
              <div><dt>Company</dt><dd>{detail.company}</dd></div>
              <div><dt>Sent by</dt><dd>{detail.sentBy}</dd></div>
              {detail.version && <div><dt>Version</dt><dd>{detail.version}</dd></div>}
              {detail.sendSource && <div><dt>Recorded via</dt><dd>{detail.sendSource}</dd></div>}
              {detail.giftViewAt && <div><dt>Gift view signal</dt><dd>{fullWhen(detail.giftViewAt)}<small> Consider a personal follow-up. Scanners or forwarded links may trigger this; it does not prove interest.</small></dd></div>}
              {detail.channel === "email" && <div><dt>Open signal</dt><dd>{detail.openAt ? `Detected ${fullWhen(detail.openAt)}` : detail.trackedOpen ? "No open detected" : "Not tracked"}<small> Image loading is not proof of reading; privacy tools can trigger or block it.</small></dd></div>}
              <div><dt>When</dt><dd>{fullWhen(detail.at)}</dd></div>
              <div><dt>Status</dt><dd>{detail.replied ? <span className={`act-modal-reply ${detail.replyClass === "positive" ? "is-pos" : ""}`}>Replied{detail.replyClass === "positive" ? " · positive" : ""}</span> : "Sent · no reply yet"}</dd></div>
              {detail.inCadence && <div><dt>Cadence</dt><dd>In an active follow-up sequence</dd></div>}
            </dl>
            <div className="act-modal-body">
              {loadingBody && <span className="act-modal-loading">Loading the full message…</span>}
              {(() => {
                if (loadingBody) return null;
                const text = fetched?.id === detail.id ? fetched.body : detail.body;
                if (text && !text.startsWith("(sent from Gmail)")) return text;
                return <em className="act-modal-empty">{text ? text : "No message text was recorded for this send."}</em>;
              })()}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
