"use client";

import { Check, Copy, ExternalLink, FlaskConical, Mail, MessageCircle, Send } from "lucide-react";
import { useState } from "react";
import { MessageLab } from "./MessageLab";

type DraftView = "comment" | "connection" | "email";

type Props = {
  cardId: string;
  personName: string;
  title: string;
  company: string;
  email: string | null;
  emailVerified: boolean;
  linkedinUrl: string | null;
  channel: string;
  signalSummary: string;
  initialContext: string;
  linkedinComment: string;
  linkedinNote: string;
  emailSubject: string;
  emailBody: string;
  busy: boolean;
  demo: boolean;
  sendReady: boolean;
  onEdit: (key: string, value: string) => void;
  onSave: () => void;
  onSend: () => void;
  onNotice: (message: string) => void;
};

export function MessageComposer(props: Props) {
  const [view, setView] = useState<DraftView>(() => preferredView(props.channel, Boolean(props.linkedinComment)));
  const [copied, setCopied] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const currentSocialCopy = view === "comment" ? props.linkedinComment : props.linkedinNote;

  async function copyForLinkedIn() {
    try {
      await navigator.clipboard.writeText(currentSocialCopy);
      setCopied(true);
      props.onNotice("LinkedIn draft copied. Open the profile and review it once more before posting.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      props.onNotice("Copy was blocked by the browser. Select the draft text and copy it manually.");
    }
  }

  return (
    <section className="message-composer">
      <header className="composer-head">
        <div>
          <span className="eyebrow">First-touch studio</span>
          <h3>Message to send</h3>
          <p>One prospect, three coordinated surfaces.</p>
        </div>
        <span className="composer-control"><i /> Human approved</span>
      </header>

      <button type="button" className="simulation-launch" onClick={() => setLabOpen(true)}>
        <span className="simulation-icon"><FlaskConical /></span>
        <span><small>MESSAGE LAB · PRE-SEND TEST</small><strong>Compare this draft against a challenger</strong></span>
        <span className="simulation-proof">4 perspectives<br />5 scoring lenses</span>
        <b>Run A/B simulation →</b>
      </button>

      <div className="draft-tabs" role="tablist" aria-label="Message channel">
        <button type="button" role="tab" aria-selected={view === "comment"} className={view === "comment" ? "active" : ""} onClick={() => setView("comment")}>
          <span>01</span><strong>Post reply</strong><small>{props.linkedinComment ? "Ready" : "Empty"}</small>
        </button>
        <button type="button" role="tab" aria-selected={view === "connection"} className={view === "connection" ? "active" : ""} onClick={() => setView("connection")}>
          <span>02</span><strong>Connection note</strong><small>{props.linkedinNote ? "Ready" : "Empty"}</small>
        </button>
        <button type="button" role="tab" aria-selected={view === "email"} className={view === "email" ? "active" : ""} onClick={() => setView("email")}>
          <span>03</span><strong>Email</strong><small>{props.emailVerified ? "Verified" : "Review"}</small>
        </button>
      </div>

      {view === "email" ? (
        <div className="email-compose" role="tabpanel">
          <div className="compose-recipient">
            <div className="recipient-avatar">{initials(props.personName)}</div>
            <div><span>To</span><strong>{props.personName}</strong><small>{props.email ?? "No email available"}</small></div>
            <span className="recipient-state">{props.emailVerified ? <><Check /> Verified</> : "Needs review"}</span>
          </div>
          <label className="subject-line"><span>Subject</span><input value={props.emailSubject} onChange={(event) => props.onEdit("email_subject", event.target.value)} /></label>
          <textarea className="compose-body" aria-label="Email body" value={props.emailBody} onChange={(event) => props.onEdit("email_body", event.target.value)} rows={9} />
          <div className="compose-meta"><span><Mail /> Email · direct</span><span>{props.emailBody.length} characters</span></div>
        </div>
      ) : (
        <div className="social-compose" role="tabpanel">
          <div className="social-compose-head">
            <div className="linkedin-mini">in</div>
            <div><strong>{props.personName}</strong><span>{props.title} at {props.company}</span></div>
            <span>{view === "comment" ? "PUBLIC REPLY" : "CONNECTION REQUEST"}</span>
          </div>
          <textarea
            className="compose-body"
            aria-label={view === "comment" ? "LinkedIn post reply" : "LinkedIn connection note"}
            value={currentSocialCopy}
            onChange={(event) => props.onEdit(view === "comment" ? "linkedin_comment" : "linkedin_note", event.target.value)}
            rows={8}
          />
          <div className="compose-meta">
            <span><MessageCircle /> {view === "comment" ? "Respond to the observed signal" : "Reference the signal, not the pitch"}</span>
            <span>{currentSocialCopy.length}{view === "connection" ? " / 300" : ""} characters</span>
          </div>
        </div>
      )}

      <footer className="composer-actions">
        <button type="button" className="save-draft" disabled={props.busy} onClick={props.onSave}>Save draft</button>
        {view === "email" ? (
          <button type="button" className="composer-primary" disabled={props.busy || (!props.demo && (!props.emailVerified || !props.sendReady))} onClick={props.onSend}>
            <Send /> {props.demo ? "Simulate email" : props.sendReady ? "Send email now" : "Save draft first"}<span>→</span>
          </button>
        ) : (
          <div className="social-actions">
            {props.linkedinUrl && <a href={props.linkedinUrl} target="_blank" rel="noreferrer">Open profile <ExternalLink /></a>}
            <button type="button" className="composer-primary" onClick={copyForLinkedIn}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy for LinkedIn"}<span>→</span></button>
          </div>
        )}
      </footer>
      {labOpen && <MessageLab
        cardId={props.cardId}
        demo={props.demo}
        channel={view}
        personName={props.personName}
        company={props.company}
        signalSummary={props.signalSummary}
        initialContext={props.initialContext}
        controlSubject={view === "email" ? props.emailSubject : ""}
        controlBody={view === "comment" ? props.linkedinComment : view === "connection" ? props.linkedinNote : props.emailBody}
        onApply={(variant) => {
          if (view === "email") {
            props.onEdit("email_subject", variant.subject);
            props.onEdit("email_body", variant.body);
          } else {
            props.onEdit(view === "comment" ? "linkedin_comment" : "linkedin_note", variant.body);
          }
        }}
        onClose={() => setLabOpen(false)}
        onNotice={props.onNotice}
      />}
    </section>
  );
}

function preferredView(channel: string, hasComment: boolean): DraftView {
  if (channel === "email_first") return "email";
  if (hasComment) return "comment";
  return "connection";
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
