"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReplyItem } from "@/lib/replies-view";
import { replyLabel } from "@/lib/reply-labels";
import { setCardStatus } from "@/lib/card-status";
import { CompanyLogo } from "@/components/CompanyLogo";

type Group = ReplyItem["group"];
const TABS: Array<[Group, string]> = [["needs", "Needs a response"], ["booked", "Booked"], ["closed", "Closed"]];
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/** Every reply in one place: what they wrote, how it reads, the next step, and the buttons to act on it. */
export function RepliesView({ items, nextStep, canChange }: { items: ReplyItem[]; nextStep: Record<string, string>; canChange: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Group>(items.some((item) => item.group === "needs") || !items.length ? "needs" : "booked");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const shown = items.filter((item) => item.group === tab);

  async function move(item: ReplyItem, status: "meeting" | "archived" | "replied", done: string) {
    setBusy(item.cardId);
    setNote(null);
    const result = await setCardStatus(item.cardId, status);
    setBusy(null);
    setNote({ id: item.cardId, text: result.ok ? done : result.error, ok: result.ok });
    if (result.ok) router.refresh();
  }

  return (
    <div className="replies">
      <nav className="sent-shows" role="tablist" aria-label="Show">
        {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>{label} ({items.filter((item) => item.group === key).length})</button>)}
      </nav>
      {shown.length === 0
        ? <p className="as-empty">{tab === "needs" ? "No replies need you right now. New ones show up here and in your inbox." : "Nothing here yet."}</p>
        : <ol className="replies-list">{shown.map((item) => (
            <li key={item.cardId} className="reply-card">
              <div className="reply-top">
                <CompanyLogo domain={item.domain} name={item.company || item.name} size={40} />
                <span className={`home-read is-${item.classification}`}>{replyLabel(item.classification)}</span>
                <span className="home-who"><b>{item.name}</b><small>{item.title ? `${item.title} · ` : ""}{item.company} · {day(item.repliedAt)}</small></span>
              </div>
              {item.snippet ? <blockquote className="reply-text">{item.snippet}</blockquote> : <p className="reply-text is-missing">Open the thread in Gmail to read their reply.</p>}
              <p className="reply-next"><b>Next step:</b> {nextStep[item.classification] ?? "Read it and reply from your Gmail thread."}</p>
              <div className="as-controls">
                {item.gmailUrl && <a className="btn primary" href={item.gmailUrl} target="_blank" rel="noreferrer">Reply in Gmail ↗</a>}
                <Link className="btn" href={`/brief/${item.cardId}`}>Call brief</Link>
                {canChange && item.group === "needs" && <>
                  <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void move(item, "meeting", "Marked as booked.")}>Meeting booked</button>
                  <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void move(item, "archived", "Closed. It moves to Closed.")}>Close</button>
                </>}
                {canChange && item.group !== "needs" && item.classification !== "negative" && <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => void move(item, "replied", "Back in Needs a response.")}>Reopen</button>}
              </div>
              {note?.id === item.cardId && <p className={`as-notice ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</p>}
            </li>
          ))}</ol>}
    </div>
  );
}
