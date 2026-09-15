"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type ActivityEvent = {
  id: string;
  at: string;
  day: string; // YYYY-MM-DD
  channel: string;
  owner: string;
  person: string;
  title: string;
  company: string;
  subject: string | null;
  snippet: string;
  replied: boolean;
  replyClass: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  linkedin_message: "LinkedIn message",
  linkedin_comment: "LinkedIn reply",
  linkedin_request: "LinkedIn request",
  intro_ask: "Intro",
};
const channelKind = (channel: string) => (channel === "email" ? "email" : channel === "intro_ask" ? "intro" : "linkedin");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const monthName = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
const dayLong = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";

/** History of every outreach touch — a month calendar of what was done, and the day-by-day record beneath it. */
export function ActivityView({ events }: { events: ActivityEvent[] }) {
  const byDay = useMemo(() => {
    const map = new Map<string, ActivityEvent[]>();
    for (const event of events) (map.get(event.day) ?? map.set(event.day, []).get(event.day)!).push(event);
    return map;
  }, [events]);

  const latest = events[0]?.day;
  const [cursor, setCursor] = useState(() => {
    const base = latest ? new Date(`${latest}T12:00:00`) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const monthEvents = useMemo(() => events.filter((event) => event.day.startsWith(monthKey)), [events, monthKey]);
  const shown = useMemo(() => (selectedDay ? byDay.get(selectedDay) ?? [] : monthEvents), [selectedDay, byDay, monthEvents]);

  // Build the calendar grid (Monday-first) for the cursor month.
  const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const firstWeekday = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7; // 0 = Monday
  const cells: (string | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7 !== 0) cells.push(null);

  const totals = useMemo(() => {
    let email = 0, linkedin = 0, replies = 0;
    for (const event of monthEvents) {
      if (channelKind(event.channel) === "email") email++;
      else if (channelKind(event.channel) === "linkedin") linkedin++;
      if (event.replied) replies++;
    }
    return { email, linkedin, replies, total: monthEvents.length };
  }, [monthEvents]);

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
          <div><span className="overview-kick">Outreach history</span><h1>What was sent, day by day.</h1></div>
          <div className="activity-totals">
            <div className="activity-stat"><strong>{totals.email}</strong><span>Emails</span></div>
            <div className="activity-stat"><strong>{totals.linkedin}</strong><span>LinkedIn</span></div>
            <div className="activity-stat is-reply"><strong>{totals.replies}</strong><span>Replies</span></div>
          </div>
        </header>

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
                  <div key={event.id} className="activity-row">
                    <span className="avatar sm">{initials(event.person)}</span>
                    <div className="activity-row-main">
                      <div className="activity-row-top">
                        <strong>{event.person}</strong>
                        <em className={`activity-chan k-${channelKind(event.channel)}`}>{CHANNEL_LABEL[event.channel] ?? event.channel}</em>
                        {event.replied && <em className={`activity-reply ${event.replyClass === "positive" ? "is-pos" : ""}`}>Replied</em>}
                      </div>
                      <small className="activity-row-sub">{event.title ? `${event.title} · ` : ""}{event.company}</small>
                      {event.subject && <p className="activity-row-subject">{event.subject}</p>}
                      {event.snippet && <p className="activity-row-snip">{event.snippet}</p>}
                    </div>
                    <time className="activity-row-time">{timeOf(event.at)}</time>
                  </div>
                ))}
              </div>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
