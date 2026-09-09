"use client";

import { CalendarClock, Check, ChevronDown, Mail, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";

type CadenceMode = "manual" | "automatic";
type CadenceChannel = "email" | "linkedin_comment" | "linkedin_request" | "linkedin_message" | "intro_ask";
type CadenceStep = { day: number; channel: CadenceChannel; title: string; detail: string; subject?: string; body?: string };
type Props = { cardId: string; demo: boolean; channel: string; personName: string; company: string; emailVerified: boolean; subject: string; body: string; linkedinNote: string; onActivated: (message: string) => void };

export function CadencePlanner({ cardId, demo, channel, personName, company, emailVerified, subject, body, linkedinNote, onActivated }: Props) {
  const [mode, setMode] = useState<CadenceMode>(emailVerified ? "automatic" : "manual");
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopOnReply, setStopOnReply] = useState(true);
  const [weekdaysOnly, setWeekdaysOnly] = useState(true);
  const steps = useMemo(() => buildCadence({ channel, personName, company, subject, body, linkedinNote }), [channel, personName, company, subject, body, linkedinNote]);

  async function activate() {
    if (active) return;
    if (demo) {
      setActive(true);
      onActivated(`${mode === "automatic" ? "Smart cadence activated" : "Cadence saved"} in demo mode — no messages will leave the app.`);
      return;
    }
    setBusy(true);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const response = await fetch(`/api/cards/${cardId}/cadence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode, stopOnReply, weekdaysOnly, sendWindow: "09:30–11:30", timeZone, steps }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) {
      onActivated(result.error ?? "Unable to activate cadence.");
      return;
    }
    setActive(true);
    onActivated("Cadence activated. Automatic email steps will send inside the selected window; social steps will wait for your review.");
  }

  return (
    <section className="cadence-panel">
      <header className="cadence-head">
        <div>
          <span className="eyebrow">Sequence control</span>
          <h3>Follow-through</h3>
          <p>A deliberate path from signal to conversation.</p>
        </div>
        <div className="cadence-count"><strong>{String(steps.length).padStart(2, "0")}</strong><span>touches<br />{steps.at(-1)?.day ?? 0} days</span></div>
      </header>

      <div className="cadence-mode" aria-label="Cadence mode">
        <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>
          <span>Assist</span><small>Review every step</small>
        </button>
        <button type="button" className={mode === "automatic" ? "active" : ""} onClick={() => setMode("automatic")} disabled={!emailVerified}>
          <span><Sparkles /> Autopilot</span><small>{emailVerified ? "Email advances for you" : "Verified email required"}</small>
        </button>
      </div>

      <div className="cadence-recommendation">
        <Sparkles />
        <p><strong>Recommended route for this signal</strong><span>Start socially while the trigger is fresh, then shift to direct email. Automatic steps are visibly marked.</span></p>
        <span className="cadence-window"><CalendarClock /> 9:30–11:30</span>
      </div>

      <ol className="cadence-timeline">
        {steps.map((step, index) => {
          const automatic = mode === "automatic" && step.channel === "email";
          return (
            <li key={`${step.day}-${step.channel}`}>
              <div className="cadence-day"><strong>{step.day === 0 ? "NOW" : `D${step.day}`}</strong><span>{String(index + 1).padStart(2, "0")}</span></div>
              <div className="cadence-step-icon">{step.channel === "email" ? <Mail /> : <MessageCircle />}<i /></div>
              <div className="cadence-step-copy">
                <div><strong>{step.title}</strong><span className={automatic ? "auto-step" : "review-step"}>{automatic ? "AUTO" : "REVIEW"}</span></div>
                <p>{step.detail}</p>
                {step.body && index > 0 && <details><summary>View copy <ChevronDown /></summary><div>{step.subject && <b>{step.subject}</b>}<p>{step.body}</p></div></details>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="cadence-rules">
        <label><input type="checkbox" checked={stopOnReply} onChange={(event) => setStopOnReply(event.target.checked)} /><span><strong>Stop on reply</strong><small>Immediate</small></span></label>
        <label><input type="checkbox" checked={weekdaysOnly} onChange={(event) => setWeekdaysOnly(event.target.checked)} /><span><strong>Weekdays</strong><small>Local time</small></span></label>
        <div><ShieldCheck /><span><strong>Guardrails on</strong><small>3-day spacing</small></span></div>
      </div>

      <button type="button" className={`activate-cadence ${active ? "activated" : ""}`} onClick={activate} disabled={busy || active}>
        {active ? <><Check /> Cadence active</> : <>{mode === "automatic" ? "Activate autopilot" : "Save assisted cadence"}<span>→</span></>}
      </button>
      <p className="cadence-disclosure">Email can advance automatically. LinkedIn and introductions always pause for human action.</p>
    </section>
  );
}

function buildCadence({ channel, personName, company, subject, body, linkedinNote }: { channel: string; personName: string; company: string; subject: string; body: string; linkedinNote: string }): CadenceStep[] {
  const firstName = personName.split(" ")[0];
  const followup = `${firstName} — sharing this once more in case the timing is useful. I can send the one-page operating pattern I mentioned; no meeting needed.`;
  const close = `${firstName} — I’ll close the loop here. If this becomes a priority at ${company}, I’m happy to share the framework.`;
  if (channel === "email_first") return [{ day: 0, channel: "email", title: "Send the evidence-led email", detail: subject || "Open with the observed change", subject, body }, { day: 3, channel: "linkedin_request", title: "View profile and connect", detail: "Use the signal as context; do not repeat the email.", body: linkedinNote }, { day: 5, channel: "email", title: "Useful follow-up", detail: "Offer the asset without asking for a meeting.", subject: `Re: ${subject}`, body: followup }, { day: 10, channel: "email", title: "Close the loop", detail: "A short, respectful final note.", subject: `Re: ${subject}`, body: close }];
  if (channel === "intro") return [{ day: 0, channel: "intro_ask", title: "Request the warm introduction", detail: "Give the connector a one-sentence reason and an easy out." }, { day: 3, channel: "linkedin_message", title: "Send a direct note", detail: "Only if the introduction has not moved.", body: linkedinNote }, { day: 7, channel: "email", title: "Share the useful framework", detail: "Continue only after a warm response.", subject, body }];
  if (channel === "linkedin_only") return [{ day: 0, channel: "linkedin_comment", title: "Engage with the source", detail: "Add a specific observation; no pitch." }, { day: 1, channel: "linkedin_request", title: "Send the connection note", detail: linkedinNote }, { day: 5, channel: "linkedin_message", title: "Follow up after acceptance", detail: "Ask one informed question from the decision brief." }];
  return [{ day: 0, channel: "linkedin_comment", title: "Respond to the source", detail: "Add the drafted insight while the post is fresh." }, { day: 1, channel: "linkedin_request", title: "Send the connection note", detail: linkedinNote }, { day: 3, channel: "email", title: "Send the evidence-led email", detail: subject || "Reference the same operating question", subject, body }, { day: 7, channel: "email", title: "Useful follow-up", detail: "Offer the asset without adding pressure.", subject: `Re: ${subject}`, body: followup }, { day: 10, channel: "email", title: "Close the loop", detail: "Stop cleanly after one final note.", subject: `Re: ${subject}`, body: close }];
}
