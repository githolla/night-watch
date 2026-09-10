"use client";

import { useState } from "react";
import Link from "next/link";
import { CadencePlanner } from "./CadencePlanner";
import { MessageComposer } from "./MessageComposer";
import { RunNightWatchButton } from "./RunNightWatchButton";
import { SignalInsight, type InsightCard } from "./SignalInsight";

type Card = InsightCard & {
  id: string;
  status: string;
  brief: string;
  assigned_to: string;
  email_subject: string | null;
  email_body: string | null;
  linkedin_note: string | null;
  linkedin_comment?: string | null;
  people: InsightCard["people"] & {
    email: string | null;
    email_status: string;
    linkedin_url: string | null;
  };
};

export type EmptyDeskState = {
  targetTotal: number;
  activeAccounts: number;
  researchedAccounts: number;
  lastRun: null | {
    status: string;
    startedAt: string;
    accounts: number;
    signals: number;
    cards: number;
    errors: number;
  };
};

export function Desk({
  initialCards,
  selectedId,
  demo = false,
  gmailConnected = false,
  emptyState,
}: {
  initialCards: Card[];
  selectedId?: string;
  demo?: boolean;
  gmailConnected?: boolean;
  emptyState?: EmptyDeskState;
}) {
  const [cards, setCards] = useState(initialCards);
  const [selected, setSelected] = useState(selectedId ?? cards[0]?.id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState("positive");
  const card = cards.find((item) => item.id === selected) ?? cards[0];
  const cardIndex = Math.max(0, cards.findIndex((item) => item.id === card?.id));

  async function patch(values: Record<string, unknown>) {
    if (demo) {
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, ...values } : item));
      setNotice("Demo updated locally — nothing was saved or sent.");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/cards/${card.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) return alert(json.error);
    setCards((current) => current.map((item) => item.id === card.id ? { ...item, ...json } : item));
  }

  async function send() {
    if (demo) {
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "sent" } : item));
      setNotice("Demo send simulated — no email left the app.");
      return;
    }
    if (!confirm(`Send this email to ${card.people.email}?`)) return;
    setBusy(true);
    const response = await fetch(`/api/cards/${card.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: card.email_subject, body: card.email_body }),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) return alert(json.error);
    setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "sent" } : item));
    setNotice("Message sent. The activity record and reply watch are now active.");
  }

  async function recordTouch(view: "comment" | "connection" | "email", body: string) {
    const label = view === "email" ? "manual email" : view === "comment" ? "LinkedIn reply" : "LinkedIn connection request";
    if (!demo && !confirm(`Record this ${label} as sent?`)) return;
    if (demo) {
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "sent" } : item));
      setNotice(`${label} recorded in demo mode.`);
      return;
    }
    setBusy(true);
    const channel = view === "email" ? "email" : view === "comment" ? "linkedin_comment" : "linkedin_request";
    const response = await fetch(`/api/cards/${card.id}/touch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, body }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setNotice(result.error ?? "Unable to record outreach.");
    setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "sent" } : item));
    setNotice(`${label} recorded. Learning will now include this touch.`);
  }

  async function recordOutcome() {
    if (demo) {
      const status = outcome === "meeting" ? "meeting" : ["positive", "referral"].includes(outcome) ? "positive" : "replied";
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status } : item));
      setNotice("Outcome recorded in demo mode.");
      return;
    }
    setBusy(true);
    const response = await fetch(`/api/cards/${card.id}/outcome`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setNotice(result.error ?? "Unable to record outcome.");
    setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: result.status } : item));
    setNotice("Outcome recorded. Signal and message analytics have been updated.");
  }

  const edit = (key: string, value: string) => setCards((current) => current.map((item) => item.id === card.id ? { ...item, [key]: value } : item));
  const choose = (id: string) => {
    setSelected(id);
    setNotice("");
    document.querySelector(".detail")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  const move = (offset: number) => {
    const next = cards[(cardIndex + offset + cards.length) % cards.length];
    if (next) choose(next.id);
  };

  return (
    <main className="desk">
      <section className="queue">
        <div className="queue-head">
          <div className="eyebrow">Morning decision queue</div>
          <h1>{cards.length} people</h1>
          <p>Each dossier combines the trigger, supporting evidence, person fit, timing, risk, and recommended move.</p>
          <div className="queue-summary">
            <div><strong>{cards.filter((item) => item.score >= 80).length}</strong><span>PRIORITY</span></div>
            <div><strong>{cards.reduce((sum, item) => sum + (item.supporting_signals?.length ?? 1), 0)}</strong><span>SIGNALS</span></div>
            <div><strong>{cards.filter((item) => item.people.path_score > 0).length}</strong><span>WARM PATHS</span></div>
          </div>
        </div>
        {cards.map((item, index) => (
          <button key={item.id} className={`queue-card ${item.id === card?.id ? "active" : ""}`} onClick={() => choose(item.id)}>
            <div className="queue-card-top">
              <span className="queue-index">0{index + 1}</span>
              <span className="badge">{item.signals.type?.replaceAll("_", " ") ?? item.channel.replaceAll("_", " ")}</span>
              <span className="queue-fresh">{item.signals.observed_at ? freshness(item.signals.observed_at) : "recent"}</span>
              <span className="score">{item.score}</span>
            </div>
            <h3>{item.people.full_name}</h3>
            <small>{item.people.title} · {item.accounts.name}</small>
            <p>{item.why_now}</p>
            <div className="queue-reason">
              <span>{item.supporting_signals?.length ?? 1} EVIDENCE POINTS</span>
              <span>{item.channel.replaceAll("_", " ")}</span>
              <span>{item.people.path_score > 0 ? `PATH ${item.people.path_score}/10` : "COLD"}</span>
            </div>
          </button>
        ))}
      </section>

      <section className="detail">
        {!card ? (
          <div className="detail-inner empty-desk">
            <div className="eyebrow">Research status</div>
            <h1>The target list is here. Research still has to run.</h1>
            <p className="empty-desk-intro">The Morning Desk is not a company directory. It only shows people whose recent public signal passed the 60-point threshold. Browse all targets separately, then run a first scan to create real dossiers.</p>
            <div className="empty-desk-metrics">
              <div><span>SUPPLIED TARGETS</span><strong>{emptyState?.targetTotal.toLocaleString() ?? "—"}</strong><small>Companies in your CSV</small></div>
              <div><span>ACTIVE IN DATABASE</span><strong>{emptyState?.activeAccounts.toLocaleString() ?? "—"}</strong><small>{emptyState && emptyState.activeAccounts === emptyState.targetTotal ? "List is synchronized" : "Open Targets and sync the list"}</small></div>
              <div><span>RESEARCHED</span><strong>{emptyState?.researchedAccounts.toLocaleString() ?? "—"}</strong><small>Companies checked at least once</small></div>
              <div><span>DESK CARDS</span><strong>0</strong><small>No signal has cleared the threshold today</small></div>
            </div>
            {emptyState?.lastRun ? <section className="last-run-card"><div><span>LAST RESEARCH RUN</span><strong>{emptyState.lastRun.status} · {emptyState.lastRun.startedAt}</strong></div><dl><div><dt>Companies</dt><dd>{emptyState.lastRun.accounts}</dd></div><div><dt>Signals</dt><dd>{emptyState.lastRun.signals}</dd></div><div><dt>Cards</dt><dd>{emptyState.lastRun.cards}</dd></div><div><dt>Errors</dt><dd>{emptyState.lastRun.errors}</dd></div></dl></section> : <p className="empty-desk-alert">No research run has been recorded yet.</p>}
            <div className="empty-desk-actions">
              <Link className="btn" href="/targets">Browse and sync targets</Link>
              <RunNightWatchButton disabled={!emptyState || emptyState.activeAccounts !== emptyState.targetTotal} />
            </div>
            {emptyState && emptyState.activeAccounts !== emptyState.targetTotal && <p className="empty-desk-note">Synchronize the complete target list before starting the first scan.</p>}
          </div>
        ) : (
          <div className="detail-inner">
            <div className="desk-context-bar">
              <div><span>DOSSIER</span><strong>{String(cardIndex + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}</strong></div>
              <div><span>SIGNAL</span><strong>{card.signals.type?.replaceAll("_", " ") ?? "Market change"}</strong></div>
              <div><span>OWNER</span><strong>{card.assigned_to}</strong></div>
              <div><span>STATUS</span><strong>{card.status}</strong></div>
              <div className="desk-nav">
                <button onClick={() => move(-1)} aria-label="Previous person">←</button>
                <button onClick={() => move(1)} aria-label="Next person">→</button>
              </div>
            </div>

            <div className="person-header">
              <div>
                <div className="row"><span className="badge">{card.status}</span><span className="owner-label">Human review required</span></div>
                <h1>{card.people.full_name}</h1>
                <p className="subtitle">{card.people.title} at {card.accounts.name}</p>
              </div>
              <div className="person-contact"><span>{card.people.email ?? "No verified email"}</span><span>{card.people.email_status}</span></div>
            </div>

            {notice && <p className="notice">{notice}</p>}
            <SignalInsight card={card} />

            <div className="detail-section-head outreach-section-head">
              <div><div className="eyebrow">04 / Outreach control</div><h2>Message and follow-through</h2></div>
              <span>{card.channel.replaceAll("_", " ")}</span>
            </div>

            <div className="grid route-grid">
              <div className="panel">
                <h2>Contact route</h2>
                <dl className="contact-route">
                  <div><dt>Email</dt><dd>{card.people.email ?? "Not available"} <span className="badge">{card.people.email_status}</span></dd></div>
                  <div><dt>Relationship</dt><dd>{card.people.path_score}/10 · {card.people.connection_status}</dd></div>
                  <div><dt>Assigned owner</dt><dd>{card.assigned_to}</dd></div>
                </dl>
                {card.people.linkedin_url && <a href={card.people.linkedin_url} target="_blank" rel="noreferrer">Inspect public profile ↗</a>}
              </div>
              <div className="panel">
                <h2>Analyst research memo</h2>
                <p>{card.brief}</p>
                <p className="memo-note">Use this context to edit the copy. Do not repeat it verbatim to the prospect.</p>
              </div>
            </div>

            <div className="outreach-workspace">
              <MessageComposer
                key={card.id}
                cardId={card.id}
                personName={card.people.full_name}
                title={card.people.title}
                company={card.accounts.name}
                email={card.people.email}
                emailVerified={card.people.email_status === "verified"}
                linkedinUrl={card.people.linkedin_url}
                channel={card.channel}
                signalSummary={card.signals.summary}
                initialContext={`${card.brief}\n\n${card.why_now}`}
                linkedinComment={card.linkedin_comment ?? ""}
                linkedinNote={card.linkedin_note ?? ""}
                emailSubject={card.email_subject ?? ""}
                emailBody={card.email_body ?? ""}
                busy={busy}
                demo={demo}
                gmailConnected={gmailConnected}
                sendReady={["approved", "edited"].includes(card.status)}
                onEdit={edit}
                onSave={() => patch({ status: "edited", email_subject: card.email_subject, email_body: card.email_body, linkedin_note: card.linkedin_note, linkedin_comment: card.linkedin_comment })}
                onSend={send}
                onRecordTouch={recordTouch}
                onNotice={setNotice}
              />

              <CadencePlanner
                cardId={card.id}
                demo={demo}
                channel={card.channel}
                personName={card.people.full_name}
                company={card.accounts.name}
                emailVerified={card.people.email_status === "verified"}
                subject={card.email_subject ?? ""}
                body={card.email_body ?? ""}
                linkedinNote={card.linkedin_note ?? ""}
                onActivated={setNotice}
              />
            </div>

            {["sent", "replied", "positive", "meeting"].includes(card.status) && <section className="outcome-recorder">
              <div><span className="eyebrow">Observed outcome</span><h3>What happened after the touch?</h3><p>Record the real response so Night Watch learns which signals and messages perform.</p></div>
              <label><span>Outcome</span><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="positive">Positive reply</option><option value="meeting">Meeting booked</option><option value="referral">Referred onward</option><option value="neutral">Neutral reply</option><option value="objection">Objection</option><option value="ooo">Out of office</option><option value="negative">Not interested</option></select></label>
              <button type="button" disabled={busy} onClick={recordOutcome}>Record outcome <span>→</span></button>
            </section>}

            <div className="actions dossier-actions">
              <button disabled={busy} className="btn" onClick={() => patch({ status: "approved" })}>Approve dossier</button>
              <button disabled={busy} className="btn" onClick={() => patch({ status: "snoozed" })}>Snooze 7d</button>
              <button disabled={busy} className="btn danger" onClick={() => patch({ status: "dismissed" })}>Dismiss</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function freshness(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}
