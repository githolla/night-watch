"use client";

import { useState } from "react";
import { FollowupPanel, type FollowupView } from "./FollowupPanel";

export type QueueItem = FollowupView & { person: string; title: string; company: string; status: string; sentAt: string | null };

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** One compact row per follow-up; clicking a row opens it with the same actions as in History. */
export function FollowupQueue({ items: initial, sent }: { items: QueueItem[]; sent: boolean }) {
  const [items, setItems] = useState(initial);
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) return <p className="review-empty">{sent ? "No follow-ups sent yet." : "Nothing here."}</p>;
  return (
    <ol className="review-list fq-list">
      {items.map((item) => {
        const isOpen = openId === item.stepId;
        const status = sent ? `Sent ${dayLabel(item.sentAt ?? item.scheduledAt)}` : item.needsYou ? "Needs you" : item.auto ? `Sends ${dayLabel(item.scheduledAt)}` : `You send ${dayLabel(item.scheduledAt)}`;
        return (
          <li key={item.stepId} className={`review-item ${isOpen ? "is-open" : ""}`}>
            <button type="button" className="review-row" aria-expanded={isOpen} onClick={() => setOpenId(isOpen ? null : item.stepId)}>
              <span className="review-who"><b>{item.person}</b><small>{item.title ? `${item.title} · ` : ""}{item.company}</small></span>
              <span className="review-mail"><b>Follow-up {item.step}{item.subject ? ` · ${item.subject}` : ""}</b><small>{item.body.split(/\n+/).map((line) => line.trim()).filter(Boolean)[1] ?? ""}</small></span>
              <span className="review-tags"><span className={`fq-status ${item.needsYou && !sent ? "needs-you" : sent ? "is-sent" : ""}`}>{status}</span><span className="review-caret" aria-hidden="true">{isOpen ? "▴" : "▾"}</span></span>
            </button>
            {isOpen && (sent
              ? <div className="review-editor"><div className="followup-text">{item.subject && <p className="followup-subject">{item.subject}</p>}<p>{item.body}</p></div></div>
              : <div className="review-editor"><FollowupPanel followup={item} onChange={(next) => setItems((current) => next ? current.map((row) => row.stepId === item.stepId ? { ...row, ...next } : row) : current.filter((row) => row.stepId !== item.stepId))} /></div>)}
          </li>
        );
      })}
    </ol>
  );
}
