"use client";

import { useState } from "react";
import { InlineConfirm } from "./InlineConfirm";

/** canAct: may edit, skip or stop (the sender or an admin). canSend: may send it now (only the sender's own seat). */
export type FollowupView = { stepId: string; step: number; scheduledAt: string; channel: string; subject: string | null; body: string; auto: boolean; needsYou: boolean; canAct: boolean; canSend: boolean };

const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** One line for a History row: when the next follow-up goes, and whether it needs a person. */
export function followupLine(followup: FollowupView) {
  if (followup.needsYou) return `Follow-up ${followup.step} needs you: open to send or skip it`;
  return `Next follow-up ${dayLabel(followup.scheduledAt)} · ${followup.auto ? "sends automatically" : "you send it that day"}`;
}

/**
 * The next follow-up after a sent email, inside its History view: read it, change it, skip it, stop all of them,
 * or send it now when it is waiting on a person. Only the seat that sent the email can act on it.
 */
export function FollowupPanel({ followup, onChange, inThread = false }: { followup: FollowupView; onChange: (next: FollowupView | null) => void; inThread?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(followup.subject ?? "");
  const [body, setBody] = useState(followup.body);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [asking, setAsking] = useState<"skip" | "stop" | "send" | null>(null);
  const isEmail = followup.channel === "email";

  async function patch(change: Record<string, unknown>) {
    const response = await fetch(`/api/cadence-steps/${followup.stepId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) });
    const json = await response.json().catch(() => ({})) as { error?: string; subject?: string | null; body?: string };
    if (!response.ok) throw new Error(json.error ?? "Could not update the follow-up.");
    return json;
  }
  async function run(label: string, work: () => Promise<void>) {
    setBusy(true); setNote(null);
    try { await work(); }
    catch (error) { setNote({ text: error instanceof Error ? error.message : `Could not ${label}.`, ok: false }); }
    finally { setBusy(false); setAsking(null); }
  }

  const save = () => run("save", async () => {
    const json = await patch({ action: "edit", body, ...(isEmail ? { subject } : {}) });
    onChange({ ...followup, subject: json.subject ?? subject, body: json.body ?? body });
    setEditing(false);
    setNote({ text: "Saved. This is the version that will go out.", ok: true });
  });
  const skip = () => run("skip", async () => {
    await patch({ action: "skipped" });
    onChange(null);
  });
  const stop = () => run("stop", async () => {
    await patch({ action: "stop" });
    onChange(null);
  });
  const sendNow = () => run("send", async () => {
    const response = await fetch(`/api/cadence-steps/${followup.stepId}/send-now`, { method: "POST" });
    const json = await response.json().catch(() => ({})) as { error?: string; stopped?: boolean; warning?: string };
    if (!response.ok) throw new Error(json.error ?? "Could not send. Check Gmail Sent before trying again.");
    setNote({ text: json.stopped ? "They already replied, so their follow-ups have been stopped." : json.warning ?? "Sent.", ok: true });
    window.setTimeout(() => onChange(null), 1800);
  });

  return (
    <section className={`followup-panel ${followup.needsYou ? "needs-you" : ""}`} aria-label="Next follow-up">
      <header>
        <b>{inThread ? `Follow-up ${followup.step} · ${dayLabel(followup.scheduledAt)}` : followup.needsYou ? `Follow-up ${followup.step} is waiting for you` : `Next follow-up · ${dayLabel(followup.scheduledAt)}`}</b>
        <small>{followup.needsYou ? "Waiting for you: it could not go out by itself. Send it now, change it, or skip it." : followup.auto ? inThread ? "Sends automatically as a reply in this thread." : "Sends automatically that day as a reply in the same thread. It stops if they reply first." : "You send this one yourself that day."}</small>
      </header>
      {editing ? (
        <div className="followup-edit">
          {isEmail && <label><span>Subject</span><input value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} /></label>}
          <label><span>Message</span><textarea rows={7} maxLength={1500} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        </div>
      ) : (
        <div className="followup-text">{followup.subject && <p className="followup-subject">{followup.subject}</p>}<p>{followup.body}</p></div>
      )}
      {followup.canAct ? (
        <div className="followup-actions">
          {editing ? <>
            <button type="button" className="btn primary" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => { setEditing(false); setSubject(followup.subject ?? ""); setBody(followup.body); }}>Cancel</button>
          </> : <>
            {followup.needsYou && isEmail && followup.canSend && <button type="button" className="btn primary" disabled={busy} onClick={() => setAsking("send")}>Send now</button>}
            <button type="button" className="btn" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn" disabled={busy} onClick={() => setAsking("skip")}>Skip this one</button>
            {!inThread && <button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking("stop")}>Stop all follow-ups</button>}
          </>}
          {asking === "send" && <InlineConfirm title="Send this follow-up now?" yes={busy ? "Sending…" : "Yes, send it"} busy={busy} onYes={() => void sendNow()} onCancel={() => setAsking(null)}>It goes from your Gmail as a reply in the same thread.</InlineConfirm>}
          {asking === "skip" && <InlineConfirm title="Skip this follow-up?" yes="Yes, skip it" busy={busy} onYes={() => void skip()} onCancel={() => setAsking(null)}>Any later follow-ups still go.</InlineConfirm>}
          {asking === "stop" && <InlineConfirm title="Stop all follow-ups to this person?" yes="Yes, stop them" busy={busy} onYes={() => void stop()} onCancel={() => setAsking(null)}>Nothing more goes to them unless you write yourself.</InlineConfirm>}
          {note && <span className={`followup-note ${note.ok ? "is-ok" : "is-bad"}`} role="status">{note.text}</span>}
        </div>
      ) : <p className="followup-note">Only the person who sent this email, or an admin, can change its follow-ups.</p>}
    </section>
  );
}

/** All follow-ups still waiting after one email, in order, with one Stop for the lot: the thread view in History. */
export function FollowupThread({ followups, onChange }: { followups: FollowupView[]; onChange: (next: FollowupView[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const canAct = followups.some((followup) => followup.canAct);
  async function stopAll() {
    setBusy(true); setNote(null);
    try {
      const response = await fetch(`/api/cadence-steps/${followups[0].stepId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(json.error ?? "Could not stop the follow-ups.");
      onChange([]);
    } catch (error) { setNote(error instanceof Error ? error.message : "Could not stop the follow-ups."); }
    finally { setBusy(false); setAsking(false); }
  }
  return (
    <div className="followup-thread">
      {followups.map((followup) => (
        <FollowupPanel key={followup.stepId} inThread followup={followup} onChange={(next) => onChange(next ? followups.map((item) => item.stepId === followup.stepId ? next : item) : followups.filter((item) => item.stepId !== followup.stepId))} />
      ))}
      {canAct && <div className="followup-thread-foot"><button type="button" className="btn ghost" disabled={busy} onClick={() => setAsking(true)}>Stop all follow-ups</button><small>They also stop by themselves as soon as {followups.length > 1 ? "this person replies" : "they reply"}.</small>{note && <span className="followup-note is-bad">{note}</span>}</div>}
      {asking && <InlineConfirm title="Stop all follow-ups to this person?" yes="Yes, stop them" busy={busy} onYes={() => void stopAll()} onCancel={() => setAsking(false)}>Nothing more goes to them unless you write yourself.</InlineConfirm>}
    </div>
  );
}
