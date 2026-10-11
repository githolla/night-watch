"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { LinkedInDone, LinkedInTask } from "@/lib/linkedin-task-list";

type Tab = "todo" | "done";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const what = (task: LinkedInTask) => task.kind === "first" ? "First message" : `Follow-up ${task.step ?? ""}`.trim();

/** Records the send through the route that already handles it: the follow-up step, or a manual touch on the card. */
async function markSent(task: LinkedInTask): Promise<string | null> {
  const request = task.stepId
    ? fetch(`/api/cadence-steps/${task.stepId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sent" }) })
    : fetch(`/api/cards/${task.cardId}/touch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "linkedin_message", body: task.message, ...(task.subject ? { subject: task.subject } : {}), ...(task.personId ? { personId: task.personId } : {}) }) });
  const response = await request.catch(() => null);
  if (!response) return "Not saved: the connection dropped. Try again.";
  if (response.ok) return null;
  const json = await response.json().catch(() => ({})) as { error?: string };
  return json.error ?? "Not saved. Try again.";
}

function TaskCard({ task, canSend, onSent }: { task: LinkedInTask; canSend: boolean; onSent: (task: LinkedInTask) => void }) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(task.message);
      setCopied(true);
      setError(null);
    } catch {
      setError("Copy did not work in this browser. Select the message and copy it by hand.");
    }
  }

  async function send() {
    setBusy(true);
    setError(null);
    const problem = await markSent(task);
    setBusy(false);
    if (problem) setError(problem); else onSent(task);
  }

  return (
    <li className="li-task">
      <div className="li-task-head">
        <span className="li-avatar" aria-hidden="true">{initials(task.name)}</span>
        <span className="li-who"><b>{task.name}</b><small>{[task.title, task.company].filter(Boolean).join(" · ")}</small></span>
        <span className={`li-dot ${task.kind === "followup" ? "is-due" : ""}`}>{what(task)}{task.kind === "followup" ? ` · due ${day(task.dueAt)}` : ""}</span>
      </div>
      {task.subject && <p className="li-subject"><span>Subject</span>{task.subject}</p>}
      <blockquote className="li-message">{task.message}</blockquote>
      <ol className="li-steps">
        <li>
          <button type="button" className={`li-btn ${copied ? "is-done" : ""}`} onClick={() => void copy()}>
            {copied ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <Copy size={16} strokeWidth={2} aria-hidden="true" />}{copied ? "Copied" : "Copy message"}
          </button>
        </li>
        <li>
          {task.profileUrl
            ? <a className={`li-btn ${opened ? "is-done" : ""}`} href={task.profileUrl} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}>
                {opened ? <Check size={16} strokeWidth={2.4} aria-hidden="true" /> : <ExternalLink size={16} strokeWidth={2} aria-hidden="true" />}Open profile
              </a>
            : <span className="li-btn is-off" aria-disabled="true" title="No LinkedIn profile saved for this person">Open profile<small>No profile saved; search LinkedIn for {task.name}</small></span>}
        </li>
        <li>
          <button type="button" className="li-btn is-primary" disabled={busy || !canSend} onClick={() => void send()}>
            <Check size={16} strokeWidth={2.4} aria-hidden="true" />{busy ? "Saving" : "Mark sent"}
          </button>
        </li>
      </ol>
      {error && <p className="li-error" role="alert">{error}</p>}
    </li>
  );
}

/** The seat's LinkedIn sends in order, each in three steps, with what was sent recently on the second tab. */
export function LinkedInTasks({ tasks: initial, done, canSend, seat }: { tasks: LinkedInTask[]; done: LinkedInDone[]; canSend: boolean; seat: string }) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [tab, setTab] = useState<Tab>("todo");
  const [note, setNote] = useState<string | null>(null);

  function sent(task: LinkedInTask) {
    setTasks((current) => current.filter((item) => item.key !== task.key));
    setNote(`${task.name}: marked sent.${task.kind === "first" ? " Follow-ups are scheduled." : ""}`);
    router.refresh();
  }

  return (
    <div className="li">
      <div className="li-bar">
        <div className="li-seg" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={tab === "todo"} className={tab === "todo" ? "is-on" : ""} onClick={() => setTab("todo")}>To do <span>{tasks.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === "done"} className={tab === "done" ? "is-on" : ""} onClick={() => setTab("done")}>Done recently <span>{done.length}</span></button>
        </div>
        {!canSend && <p className="li-hint">Only {seat} can mark these sent, since they go out from {seat}&rsquo;s LinkedIn.</p>}
      </div>
      {note && <p className="li-note" role="status">{note}</p>}

      {tab === "todo" && (tasks.length
        ? <ol className="li-list">{tasks.map((task) => <TaskCard key={task.key} task={task} canSend={canSend} onSent={sent} />)}</ol>
        : <p className="li-empty">Nothing to send on LinkedIn right now. New messages show up here when a draft is LinkedIn first, and follow-ups show up on the day they are due.</p>)}

      {tab === "done" && (done.length
        ? <ol className="li-list is-done">{done.map((item) => (
            <li key={item.id} className="li-task is-done">
              <div className="li-task-head">
                <span className="li-avatar is-done" aria-hidden="true"><Check size={16} strokeWidth={2.6} /></span>
                <span className="li-who"><b>{item.name}</b><small>{item.company}</small></span>
                <span className="li-dot is-sent">Sent {day(item.sentAt)}</span>
              </div>
              {item.message && <blockquote className="li-message is-quiet">{item.message}</blockquote>}
            </li>
          ))}</ol>
        : <p className="li-empty">No LinkedIn messages marked sent in the last 14 days.</p>)}
    </div>
  );
}
