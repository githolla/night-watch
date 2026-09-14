"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { runOutcome, type RunSummary } from "@/lib/run-status";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { CadencePlanner } from "./CadencePlanner";
import { MessageComposer } from "./MessageComposer";
import { RefreshButton } from "./RefreshButton";
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
  linkedin_message?: string | null;
  surfaced_on?: string | null;
  isNew?: boolean;
  people: InsightCard["people"] & {
    email: string | null;
    email_status: string;
    linkedin_url: string | null;
    level?: string;
  };
};

export type DeskContext = {
  today: string;
  targetTotal: number;
  activeAccounts: number;
  /** Companies on the reach-out list — the desk's own scope, matching the Companies nav count. */
  listedCompanies: number;
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
  /** What the sweep found in the last 24 hours: the nightly update on top of the baseline. */
  changes: { companies: number; newRoles: number; closedRoles: number; newPosts: number; newPeople: number };
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
  populate: { accountLimit: number; maxSearches: number; budgetUsd: number };
  populateSweep: { budgetUsd: number; searches: number; model: string };
  batchSize: number;
  projectedMaxCostUsd: number;
};

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** A card leaves the work queue once it has been snoozed, dismissed or actually contacted. */
const WORKED_STATUSES = ["snoozed", "dismissed", "sent", "replied", "positive", "meeting", "negative"];
/** How many prospects the focused worklist shows before you choose to widen it. */
const SHORTLIST = 15;

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
  scan,
}: {
  initialCards: Card[];
  selectedId?: string;
  demo?: boolean;
  gmailConnected?: boolean;
  context?: DeskContext;
  scan?: import("react").ReactNode;
}) {
  const [cards, setCards] = useState(initialCards);
  // One-at-a-time by default: the desk opens on the next prospect to work, not a list.
  // `selected` = a full-detail deep dive; `browse` = the searchable list of everyone.
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  // The full list is home; clicking a prospect drops into the one-at-a-time focus view.
  const [browse, setBrowse] = useState(!selectedId);
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? initialCards[0]?.id);
  // Start on a tight worklist — the top prospects only — and let the chips widen it when it is cleared.
  const [kind, setKind] = useState<"top" | "all" | "job" | "social">(initialCards.length > SHORTLIST ? "top" : "all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState("positive");
  // The current filter drives both the list and the one-at-a-time queue, so working through "Top" walks
  // only the shortlist, not all 161. Cards arrive sorted by score, so "top" is just the first slice.
  const actionable = cards.filter((item) => !WORKED_STATUSES.includes(item.status));
  const byKind = kind === "top" ? actionable.slice(0, SHORTLIST) : kind === "all" ? cards : cards.filter((item) => signalGroup(item) === kind);
  // The work queue: prospects in the current filter still needing a decision.
  const todo = byKind.filter((item) => !WORKED_STATUSES.includes(item.status));
  const active = selected ? cards.find((item) => item.id === selected) : undefined;
  const focusCard = todo.find((item) => item.id === focusId) ?? todo[0];
  const card = active ?? focusCard ?? cards[0];
  const hasSourceResults = (context?.recentSignals.length ?? 0) > 0;
  const cardIndex = Math.max(0, cards.findIndex((item) => item.id === card?.id));
  const focusIndex = focusCard ? todo.findIndex((item) => item.id === focusCard.id) : -1;
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

  async function recordTouch(view: "comment" | "connection" | "message" | "email", body: string) {
    const label = view === "email" ? "manual email" : view === "comment" ? "LinkedIn reply" : view === "message" ? "LinkedIn message" : "LinkedIn connection request";
    if (!demo && !confirm(`Record this ${label} as sent?`)) return;
    if (demo) {
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: "sent" } : item));
      setNotice(`${label} recorded in demo mode.`);
      return;
    }
    setBusy(true);
    const channel = view === "email" ? "email" : view === "comment" ? "linkedin_comment" : view === "message" ? "linkedin_message" : "linkedin_request";
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
  // Pick who to work next from the browse list, then drop straight back into the one-at-a-time view.
  const pick = (id: string) => { setFocusId(id); setBrowse(false); setNotice(""); };
  // The prospect to land on after the current one leaves the queue.
  const afterCurrent = () => {
    if (todo.length <= 1) return undefined;
    const from = Math.max(0, focusIndex);
    return todo[(from + 1) % todo.length]?.id;
  };
  const move = (offset: number) => {
    if (active) {
      const next = cards[(cardIndex + offset + cards.length) % cards.length];
      if (next) choose(next.id);
      return;
    }
    if (!todo.length) return;
    const from = Math.max(0, focusIndex);
    const next = todo[(from + offset + todo.length) % todo.length];
    if (next) { setFocusId(next.id); setNotice(""); }
  };

  // Arrow keys (or j/k) move between prospects, so working the queue never means hunting for a button.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (browse) return; // In the browse list the page scrolls normally; arrows drive the detail and focus views.
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowDown" || event.key === "j") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp" || event.key === "k") { event.preventDefault(); move(-1); }
      else if (event.key === "Escape") { event.preventDefault(); setSelected(undefined); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardIndex, cards.length, active, browse, focusIndex, todo.length]);

  // Jump to the top when you open a prospect or come back to the list.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [selected]);

  const priorityCount = cards.filter((item) => item.score >= PRIORITY_THRESHOLD).length;
  const needle = query.trim().toLowerCase();
  const filtered = needle ? byKind.filter((item) => `${item.people.full_name} ${item.people.title} ${item.accounts.name}`.toLowerCase().includes(needle)) : byKind;
  const jobCount = cards.filter((item) => signalGroup(item) === "job").length;
  const socialCount = cards.filter((item) => signalGroup(item) === "social").length;
  const withDraft = cards.filter((item) => item.email_body || item.linkedin_note || item.linkedin_message).length;
  const nextLine = (item: Card) => item.signals.raw?.operating_need || item.why_now || item.signals.summary;

  // The one draft to show first, picked by the card's chosen channel — email when it is verified, else the readiest LinkedIn surface.
  const primaryDraft = (item: Card): { view: "email" | "comment" | "message" | "connection"; label: string; text: string } => {
    if (item.channel === "email_first" && item.people.email_status === "verified" && item.email_body) return { view: "email", label: "Email", text: item.email_body };
    if (item.linkedin_comment) return { view: "comment", label: "LinkedIn post reply", text: item.linkedin_comment };
    if (item.linkedin_message) return { view: "message", label: "LinkedIn message", text: item.linkedin_message };
    if (item.linkedin_note) return { view: "connection", label: "Connection note", text: item.linkedin_note };
    if (item.email_body) return { view: "email", label: "Email", text: item.email_body };
    return { view: "connection", label: "Connection note", text: "" };
  };
  // A calm, plain-English read on the night for the top of the list. "New signals" is exactly the two
  // signal tiles (new roles + new AI posts) so the headline and the stat row always reconcile.
  const newRoles = context?.changes.newRoles ?? 0;
  const newPosts = context?.changes.newPosts ?? 0;
  const fresh = newRoles + newPosts;
  const companiesWatched = context?.listedCompanies ?? 0;
  const deskDateShort = context ? new Date(`${context.today}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const headline = fresh === 0 ? "A quiet night." : `${fresh.toLocaleString()} new ${fresh === 1 ? "signal" : "signals"} overnight.`;
  const subline = priorityCount > 0 ? `${priorityCount} worth a closer look.` : cards.length ? "A few good leads to work." : "Nothing needs you right now.";
  // For the analyst's-note rail: how many signals point at manual/reporting work, and the busiest companies.
  const manualCount = cards.filter((item) => /manual|report|reconcil|spreadsheet|data entry|intake|routing|invoice|dashboard/i.test(`${item.signals.raw?.operating_need ?? ""} ${item.why_now ?? ""}`)).length;
  const watchlist = Object.values(cards.reduce<Record<string, { domain: string; name: string; count: number; score: number }>>((acc, item) => {
    const key = item.accounts.domain || item.accounts.name;
    if (!acc[key]) acc[key] = { domain: item.accounts.domain ?? "", name: item.accounts.name, count: 0, score: 0 };
    acc[key].count += 1;
    acc[key].score = Math.max(acc[key].score, item.score);
    return acc;
  }, {})).sort((a, b) => b.score - a.score).slice(0, 4);
  const draft = focusCard ? primaryDraft(focusCard) : null;
  const snoozeCurrent = () => { const next = afterCurrent(); void patch({ status: "snoozed" }); setFocusId(next); setNotice(""); };
  const dismissCurrent = () => { const next = afterCurrent(); void patch({ status: "dismissed" }); setFocusId(next); setNotice(""); };
  const actOnDraft = async () => {
    if (!draft) return;
    if (draft.view === "email") { send(); return; }
    try { await navigator.clipboard.writeText(draft.text); } catch { /* the record still stands even if copy is blocked */ }
    recordTouch(draft.view, draft.text);
  };

  return (
    <main className="pipeline">
      {scan && <div className="pipeline-scan">{scan}</div>}
      {cards.length === 0 ? (
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
                <RunPanel kind="sweep" endpoint="/api/sweep/run" initialRun={context?.lastSweep ?? null} batchSize={context?.sweepBatchSize ?? 300} projectedMaxCostUsd={0} disabled={!context || !listSynced}
                  extraActions={[{ label: `Initial populate: extensive sweep of all ${(context?.activeAccounts ?? 0).toLocaleString()}`, body: { all: true, populate: true }, confirm: `Extensive first pass over all ${(context?.activeAccounts ?? 0).toLocaleString()} companies: every careers page, sitemap and job board read; a job-board search and an AI-posts search per company with the research model and ${context?.populateSweep.searches ?? 5} searches each; contacts for every company. This is the thorough pass, not the cheap one: it pauses at $${(context?.populateSweep.budgetUsd ?? 200).toFixed(0)} of measured spend per press and continues on the next.` }]} />
              </section>
              <section className="run-kind">
                <header><span className="eyebrow">02 / Research</span><h2>Find managers asking for help</h2><p>A model searches the public web for an operator at the company describing a bottleneck or asking for recommendations. Companies the sweep shows are hiring go first.</p></header>
                <RunPanel initialRun={context?.lastRun ?? null} batchSize={context?.batchSize ?? 10} projectedMaxCostUsd={context?.projectedMaxCostUsd ?? 0} disabled={!context || !listSynced}
                  extraActions={[{ label: `Initial populate: research every company, ${context?.populate.maxSearches ?? 8} searches each`, body: { populate: true }, confirm: `Research up to ${(context?.populate.accountLimit ?? 2000).toLocaleString()} companies with ${context?.populate.maxSearches ?? 8} web searches each on the research model, hiring companies first, ignoring the 7-day cooldown. Pauses at $${(context?.populate.budgetUsd ?? 150).toFixed(0)} of measured spend per press and continues on the next.` }]} />
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
      ) : active ? (
          <div className="detail-inner">
            <button type="button" className="pipeline-back" onClick={() => setSelected(undefined)}>&larr; All prospects</button>
            <div className="desk-context-bar">
              <div><span>DOSSIER</span><strong>{String(cardIndex + 1).padStart(2, "0")} / {String(cards.length).padStart(2, "0")}</strong></div>
              <div><span>SIGNAL</span><strong>{card.signals.type?.replaceAll("_", " ") ?? "Market change"}</strong></div>
              <div><span>OWNER</span><strong>{card.assigned_to}</strong></div>
              <div><span>STATUS</span><strong>{card.status}</strong></div>
              <div className="desk-nav">
                <Link href="/runs" className="desk-nav-runs">Runs</Link>
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

            <section className="why-now-brief">
              <div><span className="eyebrow">Why now</span><p>{card.why_now}</p></div>
              {card.signals.raw?.operating_need && <div><span className="eyebrow">The work they need done</span><p>{card.signals.raw.operating_need}</p></div>}
              {card.accounts.domain && <Link className="why-now-open" href={`/accounts/${card.accounts.domain}`}>Open the full company page ↗</Link>}
            </section>

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
                linkedinMessage={card.linkedin_message ?? ""}
                emailSubject={card.email_subject ?? ""}
                emailBody={card.email_body ?? ""}
                busy={busy}
                demo={demo}
                gmailConnected={gmailConnected}
                sendReady={["approved", "edited"].includes(card.status)}
                onEdit={edit}
                onSave={() => patch({ status: "edited", email_subject: card.email_subject, email_body: card.email_body, linkedin_note: card.linkedin_note, linkedin_comment: card.linkedin_comment, linkedin_message: card.linkedin_message ?? "" })}
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
              <button type="button" disabled={busy} onClick={recordOutcome}>Record outcome <span>&rarr;</span></button>
            </section>}

            <div className="actions dossier-actions">
              <button disabled={busy} className="btn" onClick={() => patch({ status: "approved" })}>Approve draft</button>
              <button disabled={busy} className="btn" onClick={() => { void patch({ status: "snoozed" }); move(1); }}>Snooze 7d</button>
              <button disabled={busy} className="btn danger" onClick={() => { void patch({ status: "dismissed" }); move(1); }}>Dismiss</button>
              <button disabled={busy} className="btn" onClick={() => move(1)}>Next person &rarr;</button>
            </div>

            <details className="full-dossier">
              <summary>Full dossier &mdash; why this person, the source, the score breakdown</summary>
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
                    <div><dt>Relationship</dt><dd>{card.people.path_score}/10 &middot; {card.people.connection_status}</dd></div>
                    <div><dt>Assigned owner</dt><dd>{card.assigned_to}</dd></div>
                  </dl>
                  {card.people.linkedin_url && <a href={card.people.linkedin_url} target="_blank" rel="noreferrer">Inspect public profile &uarr;</a>}
                </div>
              </div>
              <SignalInsight card={card} />
            </details>

            <p className="send-promise">Nothing leaves Night Watch without a click from you.</p>
          </div>
      ) : browse ? (
        <div className="overview">
          <header className="overview-head">
            <div>
              <span className="overview-kick">Your morning briefing{deskDateShort ? ` · ${deskDateShort}` : ""}</span>
              <h1>{headline}<span> {subline}</span></h1>
              <p className="overview-sub">The right signal, the right company, your next conversation.</p>
            </div>
            <div className="overview-head-actions"><RefreshButton /><Link className="btn primary" href="/targets">+ Add company</Link></div>
          </header>

          {context && (
            <div className="overview-top">
              <section className="night-hero">
                <div className="night-hero-head"><span>Night Watch</span><em className="chip">{fresh.toLocaleString()} {fresh === 1 ? "signal" : "signals"} found</em></div>
                <h2>While you were offline, opportunity was moving.</h2>
                <p className="night-hero-line"><b>{companiesWatched.toLocaleString()} companies watched.</b> {fresh.toLocaleString()} new {fresh === 1 ? "signal" : "signals"}. {priorityCount} worth a closer look.</p>
                <p className="night-hero-meta">Scanned overnight · runs again tonight, on its own</p>
              </section>
              <div className="overview-stats">
                <Link className="desk-stat" href="/outreach"><span>Companies watched</span><strong>{companiesWatched.toLocaleString()}</strong><small>on the reach-out list</small></Link>
                <Link className="desk-stat" href="/roles"><span>New job signals</span><strong>{newRoles.toLocaleString()}</strong><small>roles Nine-67 could build</small></Link>
                <Link className="desk-stat" href="/posts"><span>Employee AI posts</span><strong>{newPosts.toLocaleString()}</strong><small>conversations to join</small></Link>
                <div className="desk-stat is-priority"><span>High-fit{priorityCount ? <em className="pill pill-accent">Priority</em> : null}</span><strong>{priorityCount.toLocaleString()}</strong><small>ready for review</small></div>
              </div>
            </div>
          )}

          <div className="overview-body">
            <div className="overview-main">
              <div className="ask-bar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prospects by name, title or company" aria-label="Search prospects" /></div>
              <div className="list-filters" role="tablist" aria-label="Filter by signal">
                <button type="button" role="tab" aria-selected={kind === "top"} className={kind === "top" ? "is-on" : ""} onClick={() => setKind("top")}>Worklist <b>{Math.min(SHORTLIST, actionable.length)}</b></button>
                <button type="button" role="tab" aria-selected={kind === "all"} className={kind === "all" ? "is-on" : ""} onClick={() => setKind("all")}>All <b>{cards.length}</b></button>
                <button type="button" role="tab" aria-selected={kind === "job"} className={kind === "job" ? "is-on" : ""} onClick={() => setKind("job")}>Job posts <b>{jobCount}</b></button>
                <button type="button" role="tab" aria-selected={kind === "social"} className={kind === "social" ? "is-on" : ""} onClick={() => setKind("social")}>Social posts <b>{socialCount}</b></button>
              </div>
              <div className="signal-cards">
                {filtered.map((item) => (
                  <button type="button" key={item.id} className="signal-card" onClick={() => pick(item.id)}>
                    <div className="signal-card-head">
                      <span className="avatar">{initials(item.accounts.name)}</span>
                      <div className="signal-card-id"><strong>{item.accounts.name}</strong><small>{item.people.full_name}{item.people.title ? ` · ${item.people.title}` : ""}</small></div>
                      {item.score >= PRIORITY_THRESHOLD ? <em className="chip chip-fit">High fit</em> : item.isNew ? <em className="chip chip-new">New</em> : null}
                    </div>
                    <p className="signal-card-why">{item.why_now || item.signals.summary}</p>
                    {item.signals.raw?.operating_need && <div className="signal-card-ai"><span>The AI opportunity</span><p>{item.signals.raw.operating_need}</p></div>}
                    <div className="signal-card-foot">
                      <span className="signal-card-src">{signalLabel(item)}{signalWhen(item) ? ` · ${signalWhen(item)}` : ""}</span>
                      <span className="signal-card-cta">Craft outreach &#8599;</span>
                    </div>
                  </button>
                ))}
                {filtered.length === 0 && <p className="prospect-empty">No prospects match that search.</p>}
              </div>
            </div>

            {context && (
              <aside className="analyst-note">
                <span className="analyst-kick">Analyst&apos;s note</span>
                <h3>The opening is in the workflow.</h3>
                <p>Look beyond the job title. Repetitive reporting, manual data entry and research tasks are where Nine-67 opens a more useful conversation.</p>
                <div className="analyst-stat"><strong>{manualCount}</strong><span>signals mention manual or reporting work</span></div>
                <p className="analyst-caveat">AI fit is a hypothesis to validate, not a claim that a role can be replaced.</p>
                {watchlist.length > 0 && <div className="analyst-watch">
                  <div className="analyst-watch-head"><span>On your watchlist</span><Link href="/outreach">View all &#8599;</Link></div>
                  {watchlist.map((company) => (
                    <Link key={company.domain || company.name} href={company.domain ? `/accounts/${company.domain}` : "/outreach"} className="analyst-watch-row">
                      <span className="avatar">{initials(company.name)}</span>
                      <strong>{company.name}</strong>
                      <small>{company.count} {company.count === 1 ? "signal" : "signals"}</small>
                    </Link>
                  ))}
                </div>}
              </aside>
            )}
          </div>
        </div>
      ) : (
        <div className="focus">
          <button type="button" className="pipeline-backtofocus" onClick={() => setBrowse(true)}>&larr; All prospects</button>
          <header className="pipeline-head">
            <div><h1>Working next</h1><p>{todo.length} to work &middot; {priorityCount} priority &middot; {withDraft} with a draft</p></div>
            <Link className="btn primary" href="/runs">Runs</Link>
          </header>
          {focusCard && draft ? (
            <article className="focus-card">
              <div className="focus-topline">
                <span className="focus-progress"><span>Next</span> &middot; {focusIndex + 1} of {todo.length}</span>
                <span className="focus-score">Fit {focusCard.score}</span>
              </div>

              <div className="focus-company">
                <span className="avatar">{initials(focusCard.accounts.name)}</span>
                <div>
                  <h2 className="focus-name">{focusCard.accounts.name}{focusCard.isNew && <em className="new-label">New</em>}</h2>
                  <p className="focus-sub">{signalLabel(focusCard)} &middot; signal {signalStrength(focusCard)}/40{signalWhen(focusCard) ? ` · ${signalWhen(focusCard)}` : ""}</p>
                </div>
              </div>

              <div className="focus-block">
                <span className="focus-why-label">Why they&apos;re a good prospect</span>
                <p className="focus-why-lead">{focusCard.why_now || nextLine(focusCard)}</p>
                {focusCard.signals.raw?.operating_need && <div className="focus-sub-block"><span className="focus-why-label">What Nine-67 could build</span><p>{focusCard.signals.raw.operating_need}</p></div>}
                {signalEvidence(focusCard) && <div className="focus-sub-block"><span className="focus-why-label">{signalGroup(focusCard) === "social" ? "What they posted" : "The evidence"}</span><p className="focus-evidence-text">{signalEvidence(focusCard)}</p>{focusCard.signals.source_url && <a href={focusCard.signals.source_url} target="_blank" rel="noreferrer" className="focus-link">Open the source &#8599;</a>}</div>}
                {focusCard.accounts.domain && <Link href={`/accounts/${focusCard.accounts.domain}`} className="focus-link">Everything on {focusCard.accounts.name} &rarr;</Link>}
              </div>

              <div className="focus-block focus-who">
                <span className="focus-why-label">Who to reach out to</span>
                <div className="focus-who-head">
                  <span className="avatar">{initials(focusCard.people.full_name)}</span>
                  <div><strong>{focusCard.people.full_name}</strong><small>{focusCard.people.title || "title unknown"}</small></div>
                </div>
                <p className="focus-who-why">{whoWhy(focusCard)}</p>
                <div className="focus-who-route">
                  <span>{focusCard.people.email ? `${emailStateLabel(focusCard.people.email_status)} · ${focusCard.people.email}` : emailStateLabel(focusCard.people.email_status)}</span>
                  {focusCard.people.linkedin_url
                    ? <a href={focusCard.people.linkedin_url} target="_blank" rel="noreferrer" className="focus-link">LinkedIn profile &#8599;</a>
                    : <a href={`https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${focusCard.people.full_name} ${focusCard.accounts.name}`)}`} target="_blank" rel="noreferrer" className="focus-link">Find on LinkedIn &#8599;</a>}
                  <span className="focus-channel">Best channel: {focusCard.channel.replaceAll("_", " ")}</span>
                </div>
              </div>
              {notice && <p className="notice">{notice}</p>}

              <details className="focus-draft">
                <summary><span className="focus-draft-ch">{draft.label}</span>{draft.text ? " · draft ready — review" : " · no draft yet"}</summary>
                {draft.view === "email" && focusCard.email_subject && <p className="focus-subject">Subject &middot; {focusCard.email_subject}</p>}
                <p className="focus-draft-body">{draft.text || "No draft on file for this channel yet — open the studio to write one."}</p>
              </details>

              <div className="focus-actions">
                <button type="button" disabled={busy || (draft.view === "email" && !focusCard.people.email)} className="btn primary" onClick={actOnDraft}>
                  {draft.view === "email" ? "Send email" : "Copy & mark sent"} &rarr;
                </button>
                <button type="button" disabled={busy} className="btn" onClick={snoozeCurrent}>Snooze</button>
                <button type="button" disabled={busy} className="btn ghost danger" onClick={dismissCurrent}>Dismiss</button>
                <button type="button" className="btn ghost" onClick={() => move(1)}>Skip &rarr;</button>
                <button type="button" className="btn ghost focus-studio" onClick={() => setSelected(focusCard.id)}>Full studio &rarr;</button>
              </div>
            </article>
          ) : (
            <div className="focus-clear">
              <h2>All caught up</h2>
              <p>Every prospect has been actioned. New ones land here after the next scan.</p>
              <button type="button" className="btn" onClick={() => setBrowse(true)}>Browse all prospects</button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}


function emailStateLabel(status: string) {
  switch (status) {
    case "verified": return "Verified email";
    case "catch_all": return "Catch-all domain · unverified";
    case "unverified": return "Unverified email";
    default: return "No email on file";
  }
}

const SIGNAL_LABELS: Record<string, string> = { exec_post: "Executive post", job_post: "Job posting", job_cluster: "Hiring cluster", new_leader: "Leadership change", funding: "Funding event", event: "Public event", stack_change: "Technology change", other: "Market signal" };

function signalLabel(item: Card) {
  return SIGNAL_LABELS[item.signals.type ?? ""] ?? "Market signal";
}

/** Group a prospect's signal so the list can be filtered to job-post vs social-post intent. */
function signalGroup(item: Card): "job" | "social" | "other" {
  const type = item.signals.type ?? "";
  if (type === "job_post" || type === "job_cluster") return "job";
  if (type === "exec_post") return "social";
  return "other";
}

function signalStrength(item: Card) {
  return item.signals.strength ?? item.score_breakdown?.signal_strength ?? Math.min(40, Math.round(item.score * 0.4));
}

/** A short, human "how fresh" for the intent signal — the reason a reach-out is timely. */
function signalWhen(item: Card) {
  const r = item.signals.raw as { post?: { published_at?: string | null; published?: string | null }; source?: { published_at?: string | null } } | undefined;
  const raw = r?.post?.published_at ?? r?.post?.published ?? r?.source?.published_at ?? item.signals.observed_at;
  if (!raw) return null;
  const parsed = new Date(raw.length === 10 ? `${raw}T12:00:00` : raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const days = Math.round((Date.now() - parsed.getTime()) / 86_400_000);
  if (days <= 0) return "spotted today";
  if (days === 1) return "spotted yesterday";
  if (days < 30) return `spotted ${days} days ago`;
  return `spotted ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed)}`;
}

/** The concrete proof behind the signal: the role and tools, the post, or the source excerpt. */
function signalEvidence(item: Card): string | null {
  const raw = item.signals.raw;
  if (!raw) return item.signals.summary || null;
  if (raw.job) {
    const bits = [raw.job.title, raw.job.days_open ? `${raw.job.days_open} days open` : "", ...(raw.job.tools_named ?? [])].filter(Boolean);
    return bits.join(" · ") || item.signals.summary || null;
  }
  if (raw.post?.text) return raw.post.text;
  if (raw.source?.excerpt) return raw.source.excerpt;
  return item.signals.summary || null;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}

/** A plain sentence on why this person is the one to write to. */
function whoWhy(card: Card) {
  const first = card.people.full_name.split(/\s+/)[0];
  const base = card.people.level === "owner"
    ? `${first} owns the operations and budget this work touches — the decision-maker.`
    : card.people.level === "influencer"
    ? `${first} shapes this decision and can bring the buyer in.`
    : card.people.level === "adjacent"
    ? `${first} is close to the work — a warm way into the team.`
    : `${first} is a named contact at ${card.accounts.name}.`;
  return card.people.path_score > 0 ? `${base} Warm path ${card.people.path_score}/10.` : base;
}
