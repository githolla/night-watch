"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { runOutcome, type RunSummary } from "@/lib/run-status";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { CadencePlanner } from "./CadencePlanner";
import { CompanyTeam } from "./CompanyTeam";
import { MessageComposer } from "./MessageComposer";
import { RefreshButton } from "./RefreshButton";
import { RunPanel } from "./RunPanel";
import { SignalInsight, type InsightCard } from "./SignalInsight";

type Followup = { id: string; step: number; channel: string; title: string; detail: string; subject: string | null; body: string; status: string; scheduledAt: string };

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
  linkedin_subject?: string | null;
  surfaced_on?: string | null;
  created_at?: string | null;
  working_at?: string | null;
  working_by?: string | null;
  working?: boolean;
  isNew?: boolean;
  carriedOver?: boolean;
  followups?: Followup[];
  invite_link?: string | null;
  meeting_at?: string | null;
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
  /** Totals on file (not 24h deltas), so the overview does not overstate a baseline pass as overnight activity. */
  totalRoles: number;
  totalPosts: number;
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
  // The one-at-a-time prospect flow is home; "All prospects" opens the full list on demand.
  const [browse, setBrowse] = useState(false);
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? initialCards[0]?.id);
  // Start on a tight worklist — the top prospects only — and let the chips widen it when it is cleared.
  const [kind, setKind] = useState<"top" | "all" | "job" | "social">(initialCards.length > SHORTLIST ? "top" : "all");
  // A different contact at the same company, chosen from the "everyone on file" list, to retarget the draft to.
  const [alt, setAlt] = useState<{ cardId: string; person: AltContact } | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [refining, setRefining] = useState<"email" | "linkedin" | null>(null);
  const [editing, setEditing] = useState<{ email: boolean; linkedin: boolean }>({ email: false, linkedin: false });
  const [lastRefine, setLastRefine] = useState<{ cardId: string; channel: "email" | "linkedin"; beforeBody: string; afterBody: string; beforeSubject: string; afterSubject: string } | null>(null);
  const [channelTab, setChannelTab] = useState<"email" | "linkedin">("email");
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
    if (!response.ok) { if (isMissing(json.error)) dropStaleCard(card.id); else setNotice(json.error ?? "Send failed."); return; }
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
    if (!response.ok) { if (isMissing(result.error)) dropStaleCard(card.id); else setNotice(result.error ?? "Unable to record outreach."); return; }
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
  // An action hit a prospect the server no longer has (cleared or re-surfaced since this page loaded).
  // Drop it from the list and move on instead of leaving a dead card on screen.
  const isMissing = (message?: string) => !!message && /card not found/i.test(message);
  const dropStaleCard = (id: string) => {
    const next = afterCurrent();
    setCards((current) => current.filter((item) => item.id !== id));
    setFocusId(next);
    setNotice("That prospect was cleared or refreshed since you opened the desk — moving to the next. Reload to pull the latest list.");
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
  // Totals on file, not 24h deltas — a baseline pass should not read as overnight activity.
  const totalRoles = context?.totalRoles ?? 0;
  const totalPosts = context?.totalPosts ?? 0;
  const totalSignals = totalRoles + totalPosts;
  const companiesWatched = context?.listedCompanies ?? 0;
  const deskDateShort = context ? new Date(`${context.today}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const headline = priorityCount > 0 ? `${priorityCount} high-fit ${priorityCount === 1 ? "prospect" : "prospects"} to work.` : cards.length ? "A clean worklist for today." : "Nothing needs you right now.";
  const subline = totalSignals > 0 ? `${totalSignals.toLocaleString()} signals tracked across ${companiesWatched.toLocaleString()} companies.` : "";
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
  // The contact currently being written to — the card's person by default, or one picked from the team list.
  const altContact = alt && focusCard && alt.cardId === focusCard.id ? alt.person : null;
  const contact = altContact ?? (focusCard ? focusCard.people : null);
  const draftText = draft ? (altContact && focusCard ? retarget(draft.text, focusCard.people.full_name, altContact.full_name) : draft.text) : "";
  // Adapt a draft's names to the retargeted contact when one is chosen; both channel drafts are shown for every prospect.
  const adapt = (text: string) => (altContact && focusCard ? retarget(text, focusCard.people.full_name, altContact.full_name) : text);
  const emailDraft = focusCard?.email_body ?? "";
  const linkedinDraft = focusCard?.linkedin_message ?? focusCard?.linkedin_note ?? focusCard?.linkedin_comment ?? "";
  // After a Refine, show what changed inline: removed words struck through in red, added words highlighted.
  const diffFor = (channel: "email" | "linkedin") => (lastRefine && focusCard && lastRefine.cardId === focusCard.id && lastRefine.channel === channel ? lastRefine : null);
  const renderDiff = (before: string, after: string) => diffWords(before, after).map((seg, index) => seg.t === "same" ? <span key={index}>{seg.w}</span> : <span key={index} className={seg.t === "del" ? "diff-del" : "diff-add"}>{seg.w}</span>);
  const bodyView = (channel: "email" | "linkedin", plain: string) => { const d = diffFor(channel); return d ? renderDiff(d.beforeBody, d.afterBody) : plain; };
  const subjectView = (channel: "email" | "linkedin", plain: string) => { const d = diffFor(channel); return d && d.beforeSubject !== d.afterSubject ? renderDiff(d.beforeSubject, d.afterSubject) : plain; };
  const snoozeCurrent = () => { markWorking(false); const next = afterCurrent(); void patch({ status: "snoozed" }); setFocusId(next); setNotice(""); };
  const dismissCurrent = () => { markWorking(false); const next = afterCurrent(); void patch({ status: "dismissed" }); setFocusId(next); setNotice(""); };
  // Where the message actually gets sent, in one click — never hand-copied between windows.
  const mailtoHref = () => {
    if (!contact?.email || !focusCard) return "";
    const subject = focusCard.email_subject || `Quick idea for ${focusCard.accounts.name}`;
    const body = adapt(emailDraft || draftText);
    return `mailto:${contact.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };
  const linkedInHref = () => contact?.linkedin_url || (focusCard && contact ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${contact.full_name} ${focusCard.accounts.name}`)}` : "");
  // A verified address with Gmail connected sends inside the app; otherwise open a prefilled draft in the mail client.
  const sendEmail = () => {
    if (!contact?.email) return;
    if (draft?.view === "email" && contact.email_status === "verified" && !altContact) { send(); return; }
    const href = mailtoHref();
    if (href) { const link = document.createElement("a"); link.href = href; document.body.appendChild(link); link.click(); link.remove(); }
    if (altContact) { setNotice(`Email draft opened for ${contact.full_name} — send it from your mail app.`); return; }
    recordTouch("email", (draft?.view === "email" ? focusCard?.email_body : "") || draftText);
  };
  // Hand the prospect to the automated cadence: Night Watch sends the email itself on day 0, 3 and 7 and stops
  // the moment they reply. Auto-send needs a verified address and a connected sender, so the engine's guards
  // decide whether it fires now or waits — the API tells us which.
  const startSequence = async () => {
    if (!focusCard) return;
    const first = focusCard.people.full_name.split(/\s+/)[0] || "there";
    const subject = focusCard.email_subject || `Quick idea for ${focusCard.accounts.name}`;
    const body = focusCard.email_body || draftText;
    if (!body) { setNotice("No email draft yet — open the studio to write one first."); return; }
    const steps = [
      { day: 0, channel: "email", title: "Intro email", detail: "The opening email from the draft", subject, body },
      { day: 3, channel: "email", title: "Follow-up", detail: "A short bump", subject: `Re: ${subject}`, body: `Hi ${first},\n\nFloating this back up in case it slipped by — happy to send a quick teardown of what we'd build for ${focusCard.accounts.name} instead of the hire. Worth a look?` },
      { day: 7, channel: "email", title: "Close", detail: "A brief sign-off", subject: `Re: ${subject}`, body: `Hi ${first},\n\nI'll leave it here for now. If building this instead of hiring for it becomes a priority, just reply and I'll pick it back up.` },
    ];
    setEnrolling(true);
    try {
      const response = await fetch(`/api/cards/${focusCard.id}/cadence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "automatic", stopOnReply: true, weekdaysOnly: true, sendWindow: "9:30–16:00", timeZone: "America/New_York", steps }) });
      const json = await response.json();
      if (!response.ok) { if (isMissing(json.error)) dropStaleCard(focusCard.id); else setNotice(json.error ?? "Could not start the sequence."); return; }
      setCards((current) => current.map((item) => item.id === focusCard.id ? { ...item, status: "approved" } : item));
      setNotice(`Email sequence started for ${focusCard.people.full_name} — Night Watch sends on day 0, 3 and 7 and stops on a reply.`);
      markWorking(true);
    } catch { setNotice("Could not start the sequence."); }
    finally { setEnrolling(false); }
  };
  // LinkedIn has no send API, so open the person's LinkedIn and put the message on the clipboard — one paste, not a hunt.
  const openLinkedIn = async () => {
    const text = adapt(linkedinDraft || draftText);
    try { await navigator.clipboard.writeText(text); } catch { /* the record still stands even if copy is blocked */ }
    const href = linkedInHref();
    if (href) window.open(href, "_blank", "noopener,noreferrer");
    if (altContact) { setNotice(`LinkedIn opened for ${contact?.full_name} — the message is on your clipboard, paste it in.`); return; }
    recordTouch("connection", text);
  };
  const copyText = async (text: string, label: string) => {
    if (!text.trim()) { setNotice("Nothing to copy yet — write or refine a draft first."); return; }
    try { await navigator.clipboard.writeText(text); setNotice(`${label} copied — paste it to send.`); }
    catch { setNotice("Copy was blocked by the browser; select the text to copy it."); }
  };
  // Copy a draft to the clipboard, then offer to log it to the history — copying is how a manual send starts.
  const copyAndLog = async (channel: "email" | "linkedin") => {
    const text = adapt(channel === "email" ? emailDraft : linkedinDraft);
    await copyText(text, channel === "email" ? "Email" : "LinkedIn message");
    if (text.trim()) await recordTouch(channel === "email" ? "email" : "message", text);
  };
  // "Propose times": pull open slots from the connected calendar and drop them into the email draft to edit.
  const [proposing, setProposing] = useState(false);
  const proposeMeetingTimes = async () => {
    if (!focusCard) return;
    setProposing(true);
    setNotice("Checking your calendar for open times…");
    try {
      const response = await fetch(`/api/cards/${focusCard.id}/propose-times`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const json = await response.json();
      if (!response.ok) { setNotice(json.error ?? "Could not propose times."); return; }
      const lines = (json.slots as Array<{ label: string }>).map((slot) => `• ${slot.label}`).join("\n");
      const body = `${(focusCard.email_body ?? "").trimEnd()}\n\nWould any of these work for a quick call?\n${lines}\n\nHappy to send a calendar invite for whichever suits.`;
      edit("email_body", body);
      saveField("email_body", body);
      setNotice("Added open times from your calendar — edit as you like, then send.");
    } catch { setNotice("Could not reach your calendar."); }
    finally { setProposing(false); }
  };
  // Improve one draft with AI, in place: keep it a first-touch, tighten it, and write the result back to the card.
  const refine = async (channel: "email" | "linkedin", body: string, subject?: string) => {
    if (!focusCard) return;
    if (!body.trim()) { setNotice("Write a draft first, then refine it."); return; }
    setRefining(channel);
    try {
      const target = altContact ?? focusCard.people;
      const response = await fetch(`/api/cards/${focusCard.id}/refine`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, subject, body, personName: target.full_name, personTitle: target.title }) });
      const json = await response.json();
      if (!response.ok) { if (isMissing(json.error)) dropStaleCard(focusCard.id); else setNotice(json.error ?? "Could not refine."); return; }
      setCards((current) => current.map((item) => item.id === focusCard.id ? { ...item, ...(channel === "email" ? { email_subject: json.subject ?? item.email_subject, email_body: json.body } : { linkedin_subject: json.subject ?? item.linkedin_subject, linkedin_message: json.body }) } : item));
      setLastRefine({ cardId: focusCard.id, channel, beforeBody: body, afterBody: (json.body as string) ?? body, beforeSubject: subject ?? "", afterSubject: (json.subject as string) ?? subject ?? "" });
      setNotice("Refined — changes are highlighted. Edit further or copy to send.");
      markWorking(true);
    } catch { setNotice("Could not refine."); }
    finally { setRefining(null); }
  };
  // Persist an inline edit to the focused card's draft field, and mark the prospect as being worked.
  const saveField = (key: "email_subject" | "email_body" | "linkedin_message" | "linkedin_subject", value: string) => { void patch({ [key]: value }); markWorking(true); };
  // Shared "someone is on this" flag so the two people on the desk don't message the same prospect. Best-effort.
  function markWorking(on: boolean) {
    if (!focusCard) return;
    const id = focusCard.id;
    setCards((current) => current.map((item) => item.id === id ? { ...item, working_at: on ? new Date().toISOString() : null } : item));
    void fetch(`/api/cards/${id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => {});
  }

  const workingView = !active && !browse && cards.length > 0;
  return (
    <main className={`pipeline${workingView ? " pipeline-work" : ""}`}>
      {scan && !workingView && <div className="pipeline-scan">{scan}</div>}
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
                <div className="row"><span className="badge">{card.status}</span>{card.isNew ? <span className="new-label">New today</span> : card.carriedOver ? <span className="new-label">{carriedLabel(card.created_at)}</span> : null}<span className="owner-label">Human review required</span></div>
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
                <div className="night-hero-head"><span>Night Watch</span><em className="chip">{priorityCount.toLocaleString()} high-fit</em></div>
                <h2>Night Watch is tracking the work these teams need done.</h2>
                <p className="night-hero-line"><b>{companiesWatched.toLocaleString()} companies watched.</b> {totalSignals.toLocaleString()} signals on file. {priorityCount} worth a closer look.</p>
                <p className="night-hero-meta">Scans every night, on its own</p>
              </section>
              <div className="overview-stats">
                <Link className="desk-stat" href="/outreach"><span>Companies watched</span><strong>{companiesWatched.toLocaleString()}</strong><small>on the reach-out list</small></Link>
                <Link className="desk-stat" href="/roles"><span>Job signals</span><strong>{totalRoles.toLocaleString()}</strong><small>roles Nine-67 could build</small></Link>
                <Link className="desk-stat" href="/posts"><span>Employee AI posts</span><strong>{totalPosts.toLocaleString()}</strong><small>conversations to join</small></Link>
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
                      {item.score >= PRIORITY_THRESHOLD ? <em className="chip chip-fit">High fit</em> : item.isNew ? <em className="chip chip-new">New</em> : item.carriedOver ? <em className="chip carried">Carried over</em> : null}
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
        <div className="deskwork">
          <header className="deskwork-head">
            <div><span className="overview-kick">Your worklist</span><h1>Start the right conversation.</h1></div>
            <div className="deskwork-head-right"><span>Night Watch</span><strong>{todo.length} {todo.length === 1 ? "prospect" : "prospects"} ready</strong><button type="button" className="deskwork-overview" onClick={() => setBrowse(true)}>Overview →</button></div>
          </header>

          <div className="deskwork-grid">
            {/* LEFT — companies */}
            <aside className="deskwork-list">
              <div className="deskwork-list-head"><span>Companies <b>{todo.length}</b></span><span className="deskwork-sort">By fit ↓</span></div>
              <input className="deskwork-search" placeholder="Find a company" value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="deskwork-list-scroll">
                {(query.trim() ? todo.filter((item) => `${item.accounts.name} ${item.people.full_name}`.toLowerCase().includes(query.trim().toLowerCase())) : todo).map((item) => (
                  <button type="button" key={item.id} className={`deskwork-row ${focusCard && item.id === focusCard.id ? "is-active" : ""}`} onClick={() => pick(item.id)}>
                    <span className="avatar sm">{initials(item.accounts.name)}</span>
                    <span className="deskwork-row-id"><strong>{item.accounts.name}</strong><small>{signalLabel(item)}{item.working ? " · working" : ""}</small></span>
                    <em className="deskwork-row-fit">{item.score}</em>
                  </button>
                ))}
                {!todo.length && <p className="deskwork-empty">All caught up — new prospects land here after the next scan.</p>}
              </div>
            </aside>

            {focusCard && draft && contact ? (<>
              {/* MIDDLE — company, opening, people */}
              <section className="deskwork-mid">
                <header className="deskwork-co">
                  <span className="avatar">{initials(focusCard.accounts.name)}</span>
                  <div className="deskwork-co-name"><h2>{focusCard.accounts.name}{focusCard.isNew ? <em className="new-label">New</em> : focusCard.carriedOver ? <em className="chip carried">{carriedLabel(focusCard.created_at)}</em> : null}</h2><p>{signalLabel(focusCard)}{signalWhen(focusCard) ? ` · ${signalWhen(focusCard)}` : ""}</p></div>
                  <span className="deskwork-co-fit">{focusCard.score}<small>FIT</small></span>
                </header>

                <div className="deskwork-opening">
                  <span className="overview-kick">The opening</span>
                  <p className="deskwork-opening-lead">{focusCard.why_now || nextLine(focusCard)}</p>
                  {focusCard.signals.raw?.operating_need && <p className="deskwork-opening-need"><b>Nine-67 could build:</b> {focusCard.signals.raw.operating_need}</p>}
                  {focusCard.accounts.domain && <Link href={`/accounts/${focusCard.accounts.domain}`} className="focus-link">View signal &amp; company details &#8599;</Link>}
                </div>

                {focusCard.accounts.domain && <CompanyTeam compact domain={focusCard.accounts.domain} company={focusCard.accounts.name} activeId={altContact?.id} onSelect={(person) => { if (person.full_name === focusCard.people.full_name) { setAlt(null); return; } setAlt({ cardId: focusCard.id, person }); setNotice(`Writing to ${person.full_name}.`); }} />}
              </section>

              {/* RIGHT — draft with Email / LinkedIn tabs */}
              <section className="deskwork-draft">
                <div className="deskwork-draft-top"><span className="overview-kick">Outreach draft</span><span className="deskwork-draft-topright">{focusCard.invite_link ? <a className="deskwork-booked" href={focusCard.invite_link.startsWith("http") ? focusCard.invite_link : undefined} target="_blank" rel="noreferrer">📅 Meeting booked</a> : null}<a className="deskwork-brief-link" href={`/brief/${focusCard.id}`} target="_blank" rel="noreferrer">Call brief ↗</a></span></div>
                <div className="deskwork-draft-to">
                  <span className="avatar sm">{initials(contact.full_name)}</span>
                  <div><strong>{contact.full_name}</strong><small>{contact.title || "title unknown"} · {focusCard.accounts.name}</small></div>
                  {altContact ? <button type="button" className="focus-who-reset" onClick={() => setAlt(null)}>&#8617; {focusCard.people.full_name.split(/\s+/)[0]}</button> : <span className="deskwork-selected">Selected contact</span>}
                </div>

                <div className="deskwork-tabs">
                  <button type="button" className={`deskwork-tab ${channelTab === "email" ? "is-active" : ""}`} onClick={() => setChannelTab("email")}>✉ Email</button>
                  <button type="button" className={`deskwork-tab ${channelTab === "linkedin" ? "is-active" : ""}`} onClick={() => setChannelTab("linkedin")}><i className="li-mark">in</i> LinkedIn</button>
                  <div className="deskwork-tools">
                    <button type="button" onClick={() => setEditing((state) => ({ ...state, [channelTab]: !state[channelTab] }))}>{editing[channelTab] ? "Done" : "Edit"}</button>
                    <button type="button" disabled={refining === channelTab} onClick={() => channelTab === "email" ? refine("email", focusCard.email_body ?? "", focusCard.email_subject ?? undefined) : refine("linkedin", focusCard.linkedin_message ?? focusCard.linkedin_note ?? focusCard.linkedin_comment ?? "", focusCard.linkedin_subject ?? undefined)}>{refining === channelTab ? "Refining…" : "Refine"}</button>
                    {channelTab === "email" && <button type="button" disabled={proposing} title="Insert open times from your connected calendar" onClick={proposeMeetingTimes}>{proposing ? "Checking…" : "Propose times"}</button>}
                    <button type="button" onClick={() => copyAndLog(channelTab)}>Copy</button>
                  </div>
                </div>

                <div className="deskwork-scroll">
                {channelTab === "email" ? (
                  editing.email ? (
                    <div className="deskwork-edit">
                      <input className="focus-msg-subject" value={focusCard.email_subject ?? ""} placeholder="Subject line (optimized for a reply)" onChange={(event) => edit("email_subject", event.target.value)} onBlur={(event) => saveField("email_subject", event.target.value)} />
                      <textarea className="focus-msg-body" value={focusCard.email_body ?? ""} rows={12} placeholder="No email draft yet — press Refine to write one." onChange={(event) => edit("email_body", event.target.value)} onBlur={(event) => saveField("email_body", event.target.value)} />
                    </div>
                  ) : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head">
                        <div className="mail-row"><span>To</span><b>{contact.email ?? `${contact.full_name} · no address on file`}</b></div>
                        <div className="mail-row"><span>Subject</span><b>{subjectView("email", focusCard.email_subject || subjectGuess(focusCard, "email"))}</b></div>
                      </div>
                      {diffFor("email") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("email", adapt(emailDraft) || "No email draft yet — press Refine to write one.")}</div>
                    </div>
                  )
                ) : (
                  editing.linkedin ? (
                    <div className="deskwork-edit">
                      <input className="focus-msg-subject" value={focusCard.linkedin_subject ?? ""} placeholder="Subject (used for InMail)" onChange={(event) => edit("linkedin_subject", event.target.value)} onBlur={(event) => saveField("linkedin_subject", event.target.value)} />
                      <textarea className="focus-msg-body" value={focusCard.linkedin_message ?? focusCard.linkedin_note ?? focusCard.linkedin_comment ?? ""} rows={11} placeholder="No LinkedIn message yet — press Refine to write one." onChange={(event) => edit("linkedin_message", event.target.value)} onBlur={(event) => saveField("linkedin_message", event.target.value)} />
                    </div>
                  ) : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head"><div className="mail-row"><span>Subject</span><b>{subjectView("linkedin", focusCard.linkedin_subject || subjectGuess(focusCard, "linkedin"))}</b></div></div>
                      {diffFor("linkedin") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("linkedin", adapt(linkedinDraft) || "No LinkedIn message yet — press Refine to write one.")}</div>
                    </div>
                  )
                )}

                {(() => {
                  const seq = (focusCard.followups ?? []).filter((f) => (channelTab === "email" ? f.channel === "email" : f.channel !== "email"));
                  if (seq.length === 0) {
                    return <div className="deskwork-fu-hint">The next 3 follow-ups queue here automatically once you send or copy this {channelTab === "email" ? "email" : "message"}.</div>;
                  }
                  return <div className="deskwork-followups">
                    <div className="deskwork-fu-head">Follow-up sequence<span>{seq.length} queued · stops on a reply</span></div>
                    {seq.map((step) => (
                      <div key={step.id} className={`deskwork-fu ${step.status === "sent" ? "is-done" : ""}`}>
                        <div className="deskwork-fu-top"><strong>Step {step.step} · {step.title}</strong><span className={followupWhen(step.scheduledAt, step.status) === "due now" ? "is-due" : ""}>{followupWhen(step.scheduledAt, step.status)}</span></div>
                        {step.subject && <div className="deskwork-fu-subj">Subject: {step.subject}</div>}
                        <p className="deskwork-fu-body">{step.body}</p>
                        <button type="button" className="deskwork-fu-copy" onClick={() => copyText(step.subject ? `Subject: ${step.subject}\n\n${step.body}` : step.body, `Follow-up ${step.step}`)}>Copy follow-up</button>
                      </div>
                    ))}
                  </div>;
                })()}
                </div>

                <div className="deskwork-draft-foot">
                  <span className="deskwork-words">{(channelTab === "email" ? (focusCard.email_body ?? "") : linkedinDraft).trim().split(/\s+/).filter(Boolean).length} words</span>
                  <div className="deskwork-draft-actions">
                    {channelTab === "email"
                      ? <button type="button" disabled={busy || !contact.email} className="btn primary" onClick={sendEmail}>{contact.email_status === "verified" && !altContact ? "Send email" : "Open email"} →</button>
                      : <button type="button" className="btn primary" onClick={openLinkedIn}>Open LinkedIn →</button>}
                    {contact.email && <button type="button" disabled={enrolling} className="btn" title="Night Watch sends and follows up, stopping on a reply" onClick={startSequence}>{enrolling ? "Starting…" : "Automate"}</button>}
                    <button type="button" disabled={busy} className="btn" onClick={snoozeCurrent}>Snooze</button>
                    <button type="button" disabled={busy} className="btn ghost danger" onClick={dismissCurrent}>Dismiss</button>
                  </div>
                </div>
                {notice && <p className="notice focus-notice">{notice}</p>}
              </section>
            </>) : (
              <div className="deskwork-clear">
                <h2>All caught up</h2>
                <p>Every prospect has been actioned. New ones land here after the next scan.</p>
                <button type="button" className="btn" onClick={() => setBrowse(true)}>Overview</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}


/** Word-level diff of two strings, keeping whitespace, for showing what Refine changed. */
type DiffSeg = { t: "same" | "del" | "add"; w: string };
function diffWords(before: string, after: string): DiffSeg[] {
  const a = before.split(/(\s+)/), b = after.split(/(\s+)/);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffSeg[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: "same", w: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "del", w: a[i] }); i++; }
    else { out.push({ t: "add", w: b[j] }); j++; }
  }
  while (i < n) out.push({ t: "del", w: a[i++] });
  while (j < m) out.push({ t: "add", w: b[j++] });
  return out;
}

/** Label for a card that rolled forward from an earlier day still un-actioned. */
function carriedLabel(created?: string | null) {
  if (!created) return "Carried over";
  const date = new Date(created);
  return Number.isNaN(date.getTime()) ? "Carried over" : `From ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Human timing for a queued follow-up: sent, due now, or how many days out. */
function followupWhen(scheduledAt: string, status: string) {
  if (status === "sent") return "sent";
  if (status === "skipped") return "skipped";
  const days = Math.round((new Date(scheduledAt).getTime() - new Date().getTime()) / 86_400_000);
  if (status === "ready" || days <= 0) return "due now";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  return new Date(scheduledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

/** A tailored subject for when a draft hasn't stored one yet, so the desk never shows a blank line. */
function subjectGuess(item: Card, channel: "email" | "linkedin") {
  const type = item.signals.type ?? "";
  const company = item.accounts.name;
  const isJob = type === "job_post" || type === "job_cluster";
  const isPost = type === "exec_post";
  if (channel === "linkedin") {
    if (isJob) return `Your open roles at ${company}`.slice(0, 60);
    if (isPost) return "Your recent post on AI";
    return `An idea for ${company}`;
  }
  if (isJob) return "Your open roles, done by automation";
  if (isPost) return "Your take on AI, and one build idea";
  return `Doing more at ${company} without the hire`;
}

/** Group a prospect's signal so the list can be filtered to job-post vs social-post intent. */
function signalGroup(item: Card): "job" | "social" | "other" {
  const type = item.signals.type ?? "";
  if (type === "job_post" || type === "job_cluster") return "job";
  if (type === "exec_post") return "social";
  return "other";
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

type AltContact = { id: string; full_name: string; title: string; email: string | null; email_status: string; linkedin_url: string | null };

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "•";
}

/** Swap the draft's greeting/first-name references when the same message is aimed at a different person. */
function retarget(text: string, fromName: string, toName: string) {
  const from = fromName.split(/\s+/)[0];
  const to = toName.split(/\s+/)[0];
  if (!text || !from || !to || from === to) return text;
  return text.split(from).join(to);
}

