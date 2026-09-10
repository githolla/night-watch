"use client";

import { useState } from "react";
import Link from "next/link";
import { runOutcome, type RunSummary } from "@/lib/run-status";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { CadencePlanner } from "./CadencePlanner";
import { MessageComposer } from "./MessageComposer";
import { RunPanel } from "./RunPanel";
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
  surfaced_on?: string | null;
  isNew?: boolean;
  people: InsightCard["people"] & {
    email: string | null;
    email_status: string;
    linkedin_url: string | null;
  };
};

export type DeskContext = {
  today: string;
  targetTotal: number;
  activeAccounts: number;
  coverage: {
    neverResearched: number;
    researched: number;
    checkedNoSignal: number;
    signalsFound: number;
    dossiersReady: number;
    failedLastRun: number;
    careersChecked: number;
    careersNotFound: number;
    hiringCompanies: number;
    targetRolesOpen: number;
  };
  queue: { open: number; newToday: number; awaitingReply: number };
  recentSignals: Array<{
    company: string;
    domain: string;
    type: string;
    summary: string;
    sourceUrl: string;
    observedAt: string;
    authorName: string | null;
    authorTitle: string | null;
    sourceText: string;
    publishedAt: string;
    isPost: boolean;
  }>;
  lastRun: RunSummary | null;
  lastSweep: RunSummary | null;
  sweepBatchSize: number;
  batchSize: number;
  projectedMaxCostUsd: number;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/**
 * The headline is read from the run record and distinguishes a failed run
 * from a partial one from a genuinely quiet night. A total systems failure
 * must never read as a finding about the market.
 */
function describeRun(run: RunSummary | null) {
  const outcome = runOutcome(run);
  if (!run || outcome === "none") {
    return { outcome, title: "Run the first person-first research scan.", detail: "Night Watch looks for a named executive's post or another dated public source, identifies who made it, and drafts both LinkedIn and email outreach from that exact evidence." };
  }
  const counts = run.counts;
  const attempted = counts.ok + counts.noSignal + counts.error;
  const checked = counts.ok + counts.noSignal;
  const when = run.source === "scheduled" ? "Last night's research run" : "The last manual research run";
  switch (outcome) {
    case "in_progress":
      return { outcome, title: `A research run is in progress. ${counts.done} of ${counts.requested} companies done.`, detail: "Rows appear below as each company completes. Continue the run if it was interrupted, or stop it after the current company." };
    case "failed": {
      const codes = new Set(run.rows.filter((row) => row.status === "error").map((row) => row.errorCode ?? "unknown"));
      const sameness = codes.size === 1 ? "all with the same error" : `with ${codes.size} different errors`;
      return { outcome, title: `${when} could not check any companies. ${attempted} attempted, ${counts.error} failed — ${sameness}.`, detail: "This is a software failure, not a market finding. The error is printed in full below; fix the cause, then retry the same companies." };
    }
    case "partial":
      return { outcome, title: `${checked} of ${attempted} companies checked. ${counts.error} failed.`, detail: `${plural(counts.ok, "company", "companies")} had a public signal saved and ${counts.noSignal} had no qualifying source. The failed rows carry their error and a retry.` };
    case "quiet":
      return { outcome, title: `${plural(checked, "company", "companies")} checked, no qualifying public signal in the last 180 days.`, detail: "Every company completed without error. Night Watch only keeps a dated, source-backed development from a named person, so a quiet result is a real result." };
    case "found":
      return { outcome, title: `${plural(checked, "company", "companies")} checked. ${plural(counts.ok, "public signal")} saved, ${plural(run.cardsCreated, "dossier")} drafted.`, detail: run.cardsCreated > 0 ? "The dossiers are in the queue on the left." : "The sources below are real, but Night Watch could not yet verify both the right person and a useful message from them." };
    case "cancelled":
      return { outcome, title: `${when} was stopped before any company was checked.`, detail: "Nothing was researched and nothing was marked as researched." };
    case "empty":
      return { outcome, title: `${when} found no eligible companies to check.`, detail: "Every company is either inside its research cooldown or already queued in another run. Sync the target list if the count below is short." };
    default:
      return { outcome, title: "Research status", detail: "" };
  }
}

export function Desk({
  initialCards,
  selectedId,
  demo = false,
  gmailConnected = false,
  context,
}: {
  initialCards: Card[];
  selectedId?: string;
  demo?: boolean;
  gmailConnected?: boolean;
  context?: DeskContext;
}) {
  const [cards, setCards] = useState(initialCards);
  const [selected, setSelected] = useState(selectedId ?? cards[0]?.id);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState("positive");
  const card = cards.find((item) => item.id === selected) ?? cards[0];
  const hasSourceResults = (context?.recentSignals.length ?? 0) > 0;
  const cardIndex = Math.max(0, cards.findIndex((item) => item.id === card?.id));
  const listSynced = !context || context.activeAccounts === context.targetTotal;
  const run = describeRun(context?.lastRun ?? null);
  const coverage = context?.coverage;
  const coveragePercent = context && context.activeAccounts ? Math.round((coverage!.researched / context.activeAccounts) * 1000) / 10 : 0;

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
    if (!confirm(`Send this email to ${card.people.full_name} at ${card.people.email}?`)) return;
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
    setNotice(`Sent. The email to ${card.people.full_name} is recorded and replies are being watched.`);
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

  const queue = context?.queue ?? { open: cards.length, newToday: cards.filter((item) => item.isNew).length, awaitingReply: 0 };
  const priorityCount = cards.filter((item) => item.score >= PRIORITY_THRESHOLD).length;

  return (
    <main className="desk">
      <section className="queue">
        <div className="queue-head">
          <div className="eyebrow">Morning decision queue</div>
          <h1>{plural(cards.length, "person", "people")} to decide on</h1>
          <p>
            {queue.newToday > 0 ? `${queue.newToday} new since yesterday` : "Nothing new since yesterday"}
            {queue.awaitingReply > 0 ? ` · ${queue.awaitingReply} waiting on a reply` : ""}
          </p>
          <div className="queue-summary">
            <Link href="/desk?priority=high"><strong>{priorityCount}</strong><span>PRIORITY</span></Link>
            <Link href="/desk?new=today"><strong>{queue.newToday}</strong><span>NEW TODAY</span></Link>
            <Link href="/desk?status=sent"><strong>{queue.awaitingReply}</strong><span>AWAITING REPLY</span></Link>
          </div>
        </div>
        {cards.map((item, index) => (
          <button key={item.id} className={`queue-card ${item.id === card?.id ? "active" : ""}`} onClick={() => choose(item.id)}>
            <div className="queue-card-top">
              <span className="queue-index">{String(index + 1).padStart(2, "0")}</span>
              {item.isNew && <span className="new-label">New</span>}
              <span className="badge">{item.signals.type?.replaceAll("_", " ") ?? item.channel.replaceAll("_", " ")}</span>
              <span className="queue-fresh">{item.signals.observed_at ? freshness(item.signals.observed_at) : "recent"}</span>
              <span className="score" title={scoreTitle(item)}>{item.score}</span>
            </div>
            <h3>{item.people.full_name}</h3>
            <small>{item.people.title} · {item.accounts.name}</small>
            <div className="queue-source-snippet"><span>{item.signals.raw?.post ? "PUBLIC POST" : "PUBLIC SOURCE"} · {item.signals.observed_at ? new Date(`${item.signals.observed_at}T12:00:00`).toLocaleDateString() : "DATE UNAVAILABLE"}</span><strong>{item.signals.raw?.post?.author_name ?? item.people.full_name}</strong><p>{item.signals.raw?.post?.text ?? item.signals.summary}</p></div>
            <div className="queue-message-snippet"><span>OUTREACH READY</span><p>{item.linkedin_note || item.email_body || item.why_now}</p></div>
            <div className="queue-reason">
              <span>{item.supporting_signals?.length ?? 1} EVIDENCE POINTS</span>
              <span>{item.channel.replaceAll("_", " ")}</span>
              <span>{item.people.path_score > 0 ? `PATH ${item.people.path_score}/10` : "COLD"}</span>
            </div>
          </button>
        ))}
        {cards.length === 0 && context && (
          <div className="queue-empty">
            <strong>Nothing to decide on yet.</strong>
            <p>{coverage!.neverResearched.toLocaleString()} companies have never been researched. Start a run on the right, or open the target list.</p>
            <Link href="/targets?research=never">See the {coverage!.neverResearched.toLocaleString()} companies →</Link>
          </div>
        )}
      </section>

      <section className="detail">
        {!card ? (
          <div className="detail-inner empty-desk">
            <div className="eyebrow">Research status</div>
            <h1 className={`run-outcome-title is-${run.outcome}`}>{run.title}</h1>
            <p className="empty-desk-intro">{run.detail}</p>

            {context && (
              <nav className="coverage-strip" aria-label="Research coverage">
                <Link href="/targets?research=never" className="coverage-tile">
                  <span>NEVER RESEARCHED</span>
                  <strong>{coverage!.neverResearched.toLocaleString()}</strong>
                  <small>{coverage!.researched.toLocaleString()} of {context.activeAccounts.toLocaleString()} researched · {coveragePercent}%</small>
                  <i className="coverage-bar"><b style={{ width: `${Math.min(100, coveragePercent)}%` }} /></i>
                </Link>
                <Link href="/targets?research=hiring" className="coverage-tile is-ok">
                  <span>HIRING IN TARGET ROLES</span>
                  <strong>{coverage!.hiringCompanies.toLocaleString()}</strong>
                  <small>{coverage!.targetRolesOpen.toLocaleString()} open roles · {coverage!.careersChecked.toLocaleString()} careers pages read{coverage!.careersNotFound ? ` · ${coverage!.careersNotFound.toLocaleString()} not found` : ""}</small>
                  <i className="coverage-bar"><b style={{ width: `${context.activeAccounts ? Math.min(100, Math.round((coverage!.careersChecked / context.activeAccounts) * 100)) : 0}%` }} /></i>
                </Link>
                <Link href="/targets?research=signal" className="coverage-tile is-ok">
                  <span>SIGNALS FOUND</span>
                  <strong>{coverage!.signalsFound.toLocaleString()}</strong>
                  <small>Companies with a saved source</small>
                </Link>
                <Link href="/desk" className="coverage-tile is-ok">
                  <span>DOSSIERS READY</span>
                  <strong>{coverage!.dossiersReady.toLocaleString()}</strong>
                  <small>Open cards awaiting a decision</small>
                </Link>
                <a href="#run-log" className={`coverage-tile ${coverage!.failedLastRun > 0 ? "is-failed" : ""}`}>
                  <span>FAILED LAST RUN</span>
                  <strong>{coverage!.failedLastRun.toLocaleString()}</strong>
                  <small>{coverage!.failedLastRun > 0 ? "Errors printed in the run log" : "No errors in the last run"}</small>
                </a>
              </nav>
            )}

            {context && (
              <p className="coverage-note">
                At {context.batchSize} a night, a full pass over {context.activeAccounts.toLocaleString()} companies takes {Math.ceil(context.activeAccounts / Math.max(1, context.batchSize))} nights.
                {!listSynced && " Synchronize the complete target list before starting the first scan."}
              </p>
            )}

            <div className="empty-desk-actions">
              <section className="run-kind">
                <header><span className="eyebrow">01 / Careers sweep</span><h2>Read every careers page for open roles Nine-67 could do instead</h2><p>No model. Applicant-tracking boards and careers pages are read directly, titles are matched to the target job families, and a company hiring for that work becomes a dossier.</p></header>
                <RunPanel kind="sweep" endpoint="/api/sweep/run" initialRun={context?.lastSweep ?? null} batchSize={context?.sweepBatchSize ?? 300} projectedMaxCostUsd={0} disabled={!context || !listSynced} />
              </section>
              <section className="run-kind">
                <header><span className="eyebrow">02 / Research</span><h2>Find managers asking for help</h2><p>A model searches the public web for an operator at the company describing a bottleneck or asking for recommendations. Companies the sweep shows are hiring go first.</p></header>
                <RunPanel initialRun={context?.lastRun ?? null} batchSize={context?.batchSize ?? 10} projectedMaxCostUsd={context?.projectedMaxCostUsd ?? 0} disabled={!context || !listSynced} />
              </section>
              <Link className="btn" href="/targets">Browse and sync targets</Link>
            </div>

            {hasSourceResults && (
              <section className="unqualified-sources">
                <header><div><span className="eyebrow">Actual source feed</span><h2>Evidence found, awaiting a complete person-and-message match</h2></div><span>{context!.recentSignals.length} SOURCES</span></header>
                <div>
                  {context!.recentSignals.map((signal, index) => (
                    <a href={signal.sourceUrl} target="_blank" rel="noreferrer" key={`${signal.domain}-${signal.sourceUrl}`} className="unqualified-source-card">
                      <div className="source-card-meta"><span>{String(index + 1).padStart(2, "0")} · {signal.isPost ? "PUBLIC POST" : signal.type.replaceAll("_", " ")}</span><time>{new Date(signal.publishedAt).toLocaleDateString()}</time></div>
                      <h3>{signal.company}</h3>
                      <div className="source-card-author"><strong>{signal.authorName ?? "Publisher not named"}</strong><span>{signal.authorTitle ?? signal.domain}</span></div>
                      <blockquote>{signal.sourceText}</blockquote>
                      <footer><span>Not messaged — person or priority still needs verification</span><b>Open actual source ↗</b></footer>
                    </a>
                  ))}
                </div>
              </section>
            )}
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
                <div className="row"><span className="badge">{card.status}</span>{card.isNew && <span className="new-label">New today</span>}<span className="owner-label">Human review required</span></div>
                <h1>{card.people.full_name}</h1>
                <p className="subtitle">{card.people.title} at {card.accounts.name}</p>
                <p className="person-path">{card.people.path_score > 0 ? `Warm path · ${card.people.path_score}/10 · ${card.people.connection_status}` : "No warm path · cold outreach"}</p>
              </div>
              <div className="person-contact"><span>{card.people.email ?? "No verified email"}</span><span>{emailStateLabel(card.people.email_status)}</span></div>
            </div>

            {notice && <p className="notice">{notice}</p>}
            <SignalInsight card={card} />

            <div className="detail-section-head outreach-section-head" id="outreach-message">
              <div><div className="eyebrow">04 / The move</div><h2>Message and follow-through</h2></div>
              <span>{card.channel.replaceAll("_", " ")}</span>
            </div>

            <div className="grid route-grid">
              <div className="panel">
                <h2>What it means for them</h2>
                <p>{card.brief}</p>
                <p className="memo-note">Use this context to edit the copy. Do not repeat it verbatim to the prospect.</p>
              </div>
              <div className="panel">
                <h2>Contact route</h2>
                <dl className="contact-route">
                  <div><dt>Email</dt><dd>{card.people.email ?? "Not available"} <span className="badge">{emailStateLabel(card.people.email_status)}</span></dd></div>
                  <div><dt>Relationship</dt><dd>{card.people.path_score}/10 · {card.people.connection_status}</dd></div>
                  <div><dt>Assigned owner</dt><dd>{card.assigned_to}</dd></div>
                </dl>
                {card.people.linkedin_url && <a href={card.people.linkedin_url} target="_blank" rel="noreferrer">Inspect public profile ↗</a>}
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
            <p className="send-promise">Nothing leaves Night Watch without a click from you.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function freshness(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function emailStateLabel(status: string) {
  switch (status) {
    case "verified": return "Verified email";
    case "catch_all": return "Catch-all domain · unverified";
    case "unverified": return "Unverified email";
    default: return "No email on file";
  }
}

function scoreTitle(item: Card) {
  const breakdown = item.score_breakdown;
  if (!breakdown) return `Score ${item.score}`;
  return `Strength ${breakdown.signal_strength}/40 · Person fit ${breakdown.person_fit}/30 · Recency ${breakdown.recency}/20 · Path ${breakdown.relationship_path}/10`;
}
