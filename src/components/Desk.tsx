"use client";
import { curatedDomains } from "@/lib/curated-worklist";
import { accountBrief } from "@/lib/dossier-data";
import { dateLabel, sourceDomain } from "@/lib/dossier-data";
import { savedVariants, renderSavedVariant, type SavedVariant } from "@/lib/outreach-variants";
import { focusedAccount, revenueLabel, sortReachouts, type ReachoutSort } from "@/lib/reachout-sort";
import { focusedContact } from "@/lib/focused-contact";
import { outreachBody, withOutreachName } from "@/lib/outreach-ending";

import { useEffect, useState, type ReactNode } from "react";
import { emailStyle } from "@/lib/email-style";
import { recipientResearch, hasResearchCopy } from "@/lib/recipient-research";
import { preservesCurrentDraft } from "@/lib/draft-update-policy";
import Link from "next/link";
import { runOutcome, type RunSummary } from "@/lib/run-status";
import { hasProposedTimes, sanitizeCopy, stripProposedTimes } from "@/lib/clean";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { CadencePlanner } from "./CadencePlanner";
import { CompanyTeam } from "./CompanyTeam";
import { MessageComposer } from "./MessageComposer";
import { RefreshButton } from "./RefreshButton";
import { RunPanel } from "./RunPanel";
import { SignalInsight, type InsightCard } from "./SignalInsight";

type Followup = { id: string; step: number; channel: string; title: string; detail: string; subject: string | null; body: string; status: string; scheduledAt: string; forPerson?: string; forPersonId?: string };

type Card = InsightCard & {
  id: string;
  /** Which signal this card came from. Two cards share it when they are two people at one company. */
  signal_id?: string | null;
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
  onWorklist?: boolean;
  followups?: Followup[];
  invite_link?: string | null;
  meeting_at?: string | null;
  people: InsightCard["people"] & {
    id?: string;
    email: string | null;
    email_status: string;
    linkedin_url: string | null;
    level?: string;
  };
};

export type DeskContext = {
  today: string;
  /** Seat → the name that seat sends as, so nothing shows an operator the internal slug for their own seat. */
  seatNames?: Record<string, string>;
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
  senderName = "",
  senderGreeting = "Hi {first},",
  selectedId,
  demo = false,
  gmailConnected = false,
  context,
  scan,
  tools,
}: {
  initialCards: Card[];
  senderName?: string;
  senderGreeting?: string;
  selectedId?: string;
  /** A page-level tool rendered in the desk header (Draft tools), passed in from the server page. */
  tools?: ReactNode;
  demo?: boolean;
  gmailConnected?: boolean;
  context?: DeskContext;
  scan?: import("react").ReactNode;
}) {
  const [cards, setCards] = useState(initialCards);
  useEffect(() => {
    const receive = (event: Event) => {
      const updates = (event as CustomEvent<Array<{ id: string; beforeSubject: string | null; beforeBody: string | null; subject: string; body: string }>>).detail;
      setCards(current => current.map(card => {
        const change = updates.find(update => update.id === card.id);
        // Never replace a local edit or a card sent while background repair was running.
        if (!change || !preservesCurrentDraft(card, { status: "new", email_subject: change.beforeSubject, email_body: change.beforeBody })) return card;
        return { ...card, email_subject: change.subject, email_body: change.body };
      }));
    };
    window.addEventListener("night-watch:draft-updates", receive);
    return () => window.removeEventListener("night-watch:draft-updates", receive);
  }, []);

  // One-at-a-time by default: the desk opens on the next prospect to work, not a list.
  // `selected` = a full-detail deep dive; `browse` = the searchable list of everyone.
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  // The one-at-a-time prospect flow is home; "All prospects" opens the full list on demand.
  const [browse, setBrowse] = useState(false);
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? sortReachouts(initialCards, "revenue-desc")[0]?.id);
  const [listSort, setListSort] = useState<ReachoutSort>("revenue-desc");
  const changeSort = (value: ReachoutSort) => {
    setListSort(value);
  };
  // Start on a tight worklist — the top prospects only — and let the chips widen it when it is cleared.
  const [kind, setKind] = useState<"top" | "all" | "job" | "social">(initialCards.length > SHORTLIST ? "top" : "all");
  // A different contact at the same company, chosen from the "everyone on file" list, to retarget the draft to.
  const [alt, setAlt] = useState<{ cardId: string; person: AltContact } | null>(null);
  // Where clicking a colleague came from, so there is a way back to them. Carries the company too: without
  // it the link followed you to the next prospect, offering "back to Arjun" on a company Arjun has nothing
  // to do with.
  const [cameFrom, setCameFrom] = useState<{ cardId: string; name: string; company: string } | null>(null);
  const [openingContact, setOpeningContact] = useState<string | null>(null);
  // Bumped to force the company's people list to reload, after one of them turns out not to be a person.
  const [teamStamp, setTeamStamp] = useState(0);
  const [logged, setLogged] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  // The left list can show just today's worklist, or every active (un-worked) prospect so older
  // companies are never "lost" — the one-at-a-time flow still works from whichever pool is showing.
  const listScope = "all" as const;
  const [busy, setBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [enrolledIds, setEnrolledIds] = useState<Set<string>>(new Set());
  // Separate from `busy` so a blur-triggered autosave can't disable the Send button mid-click.
  const [sending, setSending] = useState(false);
  const [tonePreview, setTonePreview] = useState<{ cardId: string; versionId: string; label: string; original: string; originalSubject: string; subject: string; body: string } | null>(null);
  function previewTone(variant: SavedVariant) {
    if (!focusCard || altContact) return;
    const draft = renderSavedVariant(variant, focusCard.people.full_name, senderName, senderGreeting);
    setTonePreview({ cardId: focusCard.id, versionId: variant.id, label: variant.label, original: focusCard.email_body ?? "", originalSubject: focusCard.email_subject ?? "", ...draft });
  }
  async function applyTone() {
    if (!tonePreview || !focusCard || tonePreview.cardId !== focusCard.id) return;
    if ((focusCard.email_body ?? "") !== tonePreview.original || (focusCard.email_subject ?? "") !== tonePreview.originalSubject) {
      setNotice("You edited the draft. Review the saved version again before replacing your latest text.");
      setTonePreview(null);
      return;
    }
    try {
      const saved = await patchOn(focusCard.id, { saved_variant_id: tonePreview.versionId, email_subject: tonePreview.subject, email_body: tonePreview.body, status: "edited" });
      if (saved) setTonePreview(null);
    } catch { setNotice("Could not save this version. Your original is unchanged."); }
  }
  // Open the composer in edit mode so every email/message is directly editable before sending;
  // the tools row flips it to a read-only "Preview" of exactly how it will go out.
  const [editing, setEditing] = useState<{ email: boolean; linkedin: boolean }>({ email: true, linkedin: true });
  const [lastRefine, setLastRefine] = useState<{ cardId: string; channel: "email" | "linkedin"; beforeBody: string; afterBody: string; beforeSubject: string; afterSubject: string } | null>(null);
  const [channelTab, setChannelTab] = useState<"email" | "linkedin">("email");
  const [notice, setNotice] = useState("");
  const [outcome, setOutcome] = useState("positive");
  // The current filter drives both the list and the one-at-a-time queue, so working through "Top" walks
  // only the shortlist, not all 161. Cards arrive sorted by score, so "top" is just the first slice.
  // Push prospects whose email is verified (one-click sendable) to the top, keeping score order within each
  // group. Stable sort, so it doesn't reshuffle as you work. Guessed/unverified addresses sink.
  const verifiedFirst = <T extends { people: { email_status: string } }>(list: T[]) =>
    [...list].sort((a, b) => (a.people.email_status === "verified" ? 0 : 1) - (b.people.email_status === "verified" ? 0 : 1));
  const actionable = cards.filter((item) => !WORKED_STATUSES.includes(item.status));
  const byKind = verifiedFirst(kind === "top" ? actionable.slice(0, SHORTLIST) : kind === "all" ? cards : cards.filter((item) => signalGroup(item) === kind));
  // The work queue for the desk: the day's fixed worklist (stamped once each morning) so it doesn't reshuffle
  // as you work. Falls back to the score-ordered shortlist before migration 0023 is applied.
  const daily = cards.filter((item) => item.onWorklist);
  const todo = (daily.length ? daily : byKind).filter((item) => !WORKED_STATUSES.includes(item.status));
  // The pool the one-at-a-time flow walks: today's worklist, or every active prospect in "All". Verified
  // (sendable) prospects first so the operator works the ones they can send in one click.
  const sortedPool = sortReachouts(listScope === "all" ? actionable : todo, listSort);
  // One row per company. Keep a selected colleague visible without duplicating the company.
  const focusPool = sortedPool.filter(item => {
    const colleagues = sortedPool.filter(other => other.accounts.domain === item.accounts.domain);
    return item.id === (colleagues.find(other => other.id === focusId) ?? colleagues[0]).id;
  });
  const active = selected ? cards.find((item) => item.id === selected) : undefined;
  // Land on the picked card even if it isn't in the current pool (e.g. picked from the "All"/Overview list
  // while the scope is "today"), rather than silently showing focusPool[0] — a different company.
  const focusCard = focusPool.find((item) => item.id === focusId) ?? cards.find((item) => item.id === focusId) ?? focusPool[0] ?? todo[0];
  const card = active ?? focusCard ?? cards[0];
  const hasSourceResults = (context?.recentSignals.length ?? 0) > 0;
  const cardIndex = Math.max(0, cards.findIndex((item) => item.id === card?.id));
  const focusIndex = focusCard ? focusPool.findIndex((item) => item.id === focusCard.id) : -1;
  // "jenna" is a seat, not a person: the operator on it is Suuchi. Show the name that seat sends as,
  // falling back to the slug only when no profile has been filled in.
  const seatLabel = (owner: string | null | undefined) => {
    const seat = (owner ?? "").trim();
    if (!seat) return "Unassigned";
    return context?.seatNames?.[seat] || `${seat.charAt(0).toUpperCase()}${seat.slice(1)}`;
  };
  const listSynced = !context || context.activeAccounts === context.targetTotal;
  const run = describeRun(context?.lastRun ?? null);
  const coverage = context?.coverage;
  const coveragePercent = context && context.activeAccounts ? Math.round((coverage!.researched / context.activeAccounts) * 1000) / 10 : 0;

  // Every write names the card it is for. `card` (active ?? focusCard) and `focusCard` are NOT always the
  // same prospect — picking one from the list moves focusId while `selected` stays put — so a write that
  // assumed `card` saved the focused draft onto a different company's card and destroyed what was there.
  async function patchOn(cardId: string, values: Record<string, unknown>) {
    if (demo) {
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, ...values } : item));
      setNotice("Demo updated locally — nothing was saved or sent.");
      return true;
    }
    setBusy(true);
    const response = await fetch(`/api/cards/${cardId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const json = await response.json();
    setBusy(false);
    if (!response.ok) { alert(json.error); return false; }
    setCards((current) => current.map((item) => item.id === cardId ? { ...item, ...json } : item));
    return true;
  }
  /** Write to the dossier's card (the one the dossier view renders). */
  const patch = (values: Record<string, unknown>) => patchOn(card.id, values);
  /** Write to the prospect the one-at-a-time desk is showing. */
  const patchFocus = (values: Record<string, unknown>) => patchOn(focusCard?.id ?? card.id, values);

  // `target` is the prospect being sent to, and callers always pass it: this read `card`
  // (active ?? focusCard) while the desk's Send button lives in the focusCard composer, so a stale
  // `selected` would have confirmed one name and emailed a different person entirely.
  async function send(target?: Card, to?: { id?: string; full_name: string; email: string | null; email_status?: string }, bodyOverride?: string) {
    const onCard = target ?? card;
    // Who the email is actually addressed to: the card's own contact, or the colleague picked from the
    // company's team list. The server re-checks that person is at the same company.
    const who = to ?? onCard?.people;
    if (sending || !onCard || !who) return; // re-entry guard, since the button is no longer disabled by `busy`
    if (demo) {
      setCards((current) => current.map((item) => item.id === onCard.id ? { ...item, status: "sent" } : item));
      setNotice("Demo send simulated — no email left the app.");
      return;
    }
    // Warn before sending to an address we haven't verified — it's more likely to bounce, which hurts the
    // sending domain. The person can still choose to send.
    const unverified = who.email_status !== "verified";
    const prompt = unverified
      ? `⚠️ ${who.email} is NOT a verified address — it may bounce and hurt your sending reputation. Send anyway to ${who.full_name}?`
      : `Send this email to ${who.full_name} at ${who.email}?`;
    if (!confirm(prompt)) return;
    setSending(true);
    // A subject is required server-side; fall back rather than fail with a raw validation error.
    const subject = (onCard.email_subject ?? "").trim() || subjectGuess(onCard, "email");
    const response = await fetch(`/api/cards/${onCard.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body: bodyOverride ?? onCard.email_body, personId: who && "id" in who ? who.id : undefined }),
    });
    const json = await response.json().catch(() => ({}));
    setSending(false);
    if (!response.ok) { if (isMissing(json.error)) dropStaleCard(); else setNotice(json.error ?? "Send failed."); return; }
    setCards((current) => current.map((item) => item.id === onCard.id ? { ...item, status: "sent" } : item));
    // Mark the recipient in the team list straight away, so it is obvious who has already been written to
    // without waiting for a reload.
    if (who && "id" in who && who.id) setLogged((current) => new Set(current).add(who.id as string));
    setNotice(json.warning ?? `Sent. The email to ${json.to ?? who.full_name} is recorded and replies are being watched.`);
  }

  /**
   * Open a colleague on their OWN card, writing them their own email if they do not have one.
   *
   * Every contact at a company used to share one card and one draft: picking a colleague showed the first
   * contact's note with the greeting swapped, so eight people had one email between them, and any edit
   * landed on somebody else's draft. Each person now gets their own card — their own pitch, written for
   * what their role owns, and their own send, follow-ups and History with it.
   *
   * It costs nothing: the draft is composed from what is already on file, with no model call.
   */
  async function openContact(person: AltContact, from: Card) {
    if (person.id && from.people.id === person.id) { setAlt(null); setCameFrom(null); return; }
    // Their card may already be loaded — switch straight to it rather than asking the server.
    const loaded = cards.find((item) => item.people.id === person.id && (from.signal_id ? item.signal_id === from.signal_id : item.signals.source_url === from.signals.source_url));
    if (loaded) { setAlt(null); setCameFrom({ cardId: from.id, name: from.people.full_name, company: from.accounts.name }); setFocusId(loaded.id); setNotice(`Writing to ${person.full_name}.`); return; }
    if (demo) { setAlt({ cardId: from.id, person }); setNotice(`Writing to ${person.full_name}.`); return; }
    setOpeningContact(person.id);
    const response = await fetch(`/api/cards/${from.id}/draft-for`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ personId: person.id }) });
    const json = await response.json().catch(() => ({}));
    setOpeningContact(null);
    // Not a person at all — a slogan off the company's website that was filed as a contact. Say so and
    // leave the panel where it is; falling back would put a draft on screen addressed to "Hi Discover,".
    // The server has already taken it off the list, so reload the team so it disappears.
    if (json?.notAPerson) { setNotice(json.error as string); setTeamStamp((n) => n + 1); return; }
    // Couldn't give them their own card? Fall back to the old behaviour rather than leaving the click dead:
    // the first contact's note, retargeted, with the composer saying plainly that is what it is.
    if (!response.ok || !json?.card?.id) { setNotice(json?.error ?? `Could not open ${person.full_name}’s own draft. Please retry.`); return; }
    const fresh = json.card as Card;
    setCards((current) => current.some((item) => item.id === fresh.id) ? current.map((item) => item.id === fresh.id ? { ...item, ...fresh } : item) : [...current, fresh]);
    setAlt(null);
    setCameFrom({ cardId: from.id, name: from.people.full_name, company: from.accounts.name });
    setFocusId(fresh.id);
    setNotice(json.existing ? `Writing to ${person.full_name} — this is their own draft.` : `Wrote ${person.full_name} their own email, aimed at what their role owns.`);
  }

  async function recordTouch(view: "comment" | "connection" | "message" | "email", body: string, target?: { id?: string; full_name: string }, onCardOverride?: { id: string }) {
    const label = view === "email" ? "Email" : view === "comment" ? "LinkedIn reply" : view === "message" ? "LinkedIn message" : "LinkedIn request";
    // Log against the card whose draft is actually on screen (the focus card) and the contact selected on
    // THAT card. Using `card` (active ?? focusCard) could point at a different, browse-selected card than the
    // draft panel shows, while `altContact` is keyed to focusCard — that mismatch is how Copy logged touches
    // against a colleague instead of the person picked. A caller rendering its own card (the dossier
    // composer) names both the card and the contact so it can't inherit the focus card's either.
    const onCard = onCardOverride ?? focusCard ?? card;
    const who = target ?? (focusCard ? contact : card.people);
    const personId = who && "id" in who ? who.id : undefined;
    // Never let the server silently fall back to the card's default person — that mislogs the wrong contact.
    if (!onCard || !personId) { setNotice("Couldn't tell which contact to log this against — pick the person again, then retry."); return; }
    // Explicit send confirmation only; copying is not recorded as a send.
    if (demo) { setNotice(`${label} to ${who?.full_name ?? "contact"} recorded in demo mode.`); return; }
    setBusy(true);
    const channel = view === "email" ? "email" : view === "comment" ? "linkedin_comment" : view === "message" ? "linkedin_message" : "linkedin_request";
    const response = await fetch(`/api/cards/${onCard.id}/touch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, body, personId, subject: view === "email" ? (cards.find(item => item.id === onCard.id)?.email_subject ?? "") : undefined }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { if (isMissing(result.error)) dropStaleCard(); else setNotice(result.error ?? "Unable to record outreach."); return; }
    // Keep the company on the desk (don't mark the card sent) so its other contacts can still be logged.
    if (personId) setLogged((current) => new Set(current).add(personId));
    setNotice(`Logged ${label.toLowerCase()} to ${who?.full_name ?? "the contact"} — it's in History now.`);
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

  const editOn = (cardId: string, key: string, value: string) => setCards((current) => current.map((item) => item.id === cardId ? { ...item, [key]: value } : item));
  /** Edit the dossier's card. */
  const edit = (key: string, value: string) => editOn(card.id, key, value);
  /** Edit the prospect the one-at-a-time desk is showing — never whichever card happens to be `selected`. */
  const editFocus = (key: string, value: string) => editOn(focusCard?.id ?? card.id, key, value);
  const choose = (id: string) => {
    setSelected(id);
    // Keep the focus card in step with the selected one. When these diverged, a touch recorded from the
    // dossier was logged against the PREVIOUS prospect — wrong person, wrong card, wrong company.
    setFocusId(id);
    setNotice("");
    document.querySelector(".detail")?.scrollTo({ top: 0, behavior: "smooth" });
  };
  // Pick who to work next from the browse list, then drop straight back into the one-at-a-time view.
  const pick = (id: string) => {
    // If the picked prospect isn't in today's worklist, switch to the "All active" scope so it's in the
    // walked pool (and Next/Prev behave) instead of falling back to a different card.
    // Do NOT touch `selected` here: it is the view switch (a non-empty `selected` opens the full-detail
    // dossier), so setting it sent every click on a company into the dossier instead of the worklist.
    // The two views staying in step is handled by each write naming its own card, not by syncing these.
    setFocusId(id); setBrowse(false); setNotice("");
  };
  // The prospect to land on after the current one leaves the queue.
  const afterCurrent = () => {
    if (focusPool.length <= 1) return undefined;
    const from = Math.max(0, focusIndex);
    return focusPool[(from + 1) % focusPool.length]?.id;
  };
  // An action couldn't reach the prospect on the server. Non-destructive: never yank the card the user is
  // looking at — just tell them to reload. (Removing it was confusing when it fired on a card that was fine.)
  const isMissing = (message?: string) => !!message && /card not found/i.test(message);
  const dropStaleCard = () => {
    setNotice("Couldn't reach that prospect just now — reload the desk and try again.");
  };
  const move = (offset: number) => {
    if (active) {
      const next = cards[(cardIndex + offset + cards.length) % cards.length];
      if (next) choose(next.id);
      return;
    }
    if (!focusPool.length) return;
    const from = Math.max(0, focusIndex);
    const next = focusPool[(from + offset + focusPool.length) % focusPool.length];
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
  }, [cardIndex, cards.length, active, browse, focusIndex, focusPool.length, listSort]);

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
  const headline = priorityCount > 0 ? `${priorityCount} high-fit ${priorityCount === 1 ? "prospect" : "prospects"} to work.` : cards.length ? "Your selected companies." : "Nothing needs you right now.";
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
  // The list searches the company, the person, their title and their address — "see companies but also
  // search for people". Every term must match somewhere, so "quantiphi cfo" narrows rather than widens.
  const listNeedle = query.trim().toLowerCase();
  const listed = listNeedle
    ? focusPool.filter((item) => {
        const haystack = `${item.accounts.name} ${item.accounts.domain ?? ""} ${item.people.full_name} ${item.people.title ?? ""} ${item.people.email ?? ""}`.toLowerCase();
        return listNeedle.split(/\s+/).every((word) => haystack.includes(word));
      })
    : focusPool;
  const draft = focusCard ? primaryDraft(focusCard) : null;
  // The contact currently being written to — the card's person by default, or one picked from the team list.
  const altContact = alt && focusCard && alt.cardId === focusCard.id ? alt.person : null;
  const contact = altContact ?? (focusCard ? focusCard.people : null);
  const research = recipientResearch(focusCard?.accounts.domain, contact?.full_name);
  const brief = accountBrief(focusCard?.accounts.domain);
  const matchesResearch = research ? hasResearchCopy(focusCard?.email_subject, focusCard?.email_body, research) : false;
  // "Already gone out" is a fact about a PERSON, not about the card. The card is marked sent the moment its
  // first email leaves, but a colleague who has not been written to still needs an editable draft and a Send
  // button — otherwise picking them showed a read-only record of somebody else's email.
  const cardSent = Boolean(focusCard && ["sent", "replied", "positive", "meeting"].includes(focusCard.status));
  const cadenceForId = focusCard?.followups?.find((step) => step.forPersonId)?.forPersonId;
  const alreadyWritten = new Set<string>(logged);
  // Whoever the first email went to: the cadence names them, and before any cadence exists it is the card's
  // own contact.
  const firstRecipient = cadenceForId ?? (focusCard && "id" in focusCard.people ? (focusCard.people.id as string | undefined) : undefined);
  if (cardSent && firstRecipient) alreadyWritten.add(firstRecipient);
  const selectedContactId = contact && "id" in contact && contact.id ? (contact.id as string) : undefined;
  const sentAlready = Boolean(selectedContactId && alreadyWritten.has(selectedContactId));
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
  const snoozeCurrent = () => { markWorking(false); const next = afterCurrent(); void patchFocus({ status: "snoozed" }); setFocusId(next); setNotice(""); };
  const dismissCurrent = () => { markWorking(false); const next = afterCurrent(); void patchFocus({ status: "dismissed" }); setFocusId(next); setNotice(""); };
  const linkedInHref = () => contact?.linkedin_url || (focusCard && contact ? `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${contact.full_name} ${focusCard.accounts.name}`)}` : "");
  // Send a queued follow-up now rather than on the day it is scheduled for. Same guards as the scheduler;
  // only the wait is skipped. Testing the sequence used to mean editing scheduled_at in SQL and calling the
  // cron with its secret.
  const [sendingStep, setSendingStep] = useState("");
  const sendFollowupNow = async (stepId: string, label: string) => {
    if (sendingStep) return;
    if (!confirm(`Send “${label}” now instead of on its scheduled day?`)) return;
    setSendingStep(stepId);
    setNotice("Sending…");
    try {
      const response = await fetch(`/api/cadence-steps/${stepId}/send-now`, { method: "POST" });
      const json = await response.json();
      if (!response.ok) { setNotice(json.error ?? "Could not send that follow-up."); return; }
      setNotice(`Sent to ${json.to}. It threads under the first email; reload to see it marked sent.`);
    } catch { setNotice("Could not send that follow-up."); }
    finally { setSendingStep(""); }
  };
  // Send to whoever is selected. Picking a colleague used to downgrade this to "Open email", which handed
  // the work back to the user's mail client for no reason the user could see — the send route simply had no
  // way to address anyone but the card's own contact. It does now, so there is one button and it sends.
  const sendEmail = () => {
    if (!contact?.email || !focusCard) return;
    void send(focusCard, contact, altContact ? adapt(emailDraft) : undefined);
  };
  // Hand the prospect to the automated cadence: Night Watch sends the email itself on day 0, 3 and 7 and stops
  // the moment they reply. Auto-send needs a verified address and a connected sender, so the engine's guards
  // decide whether it fires now or waits — the API tells us which.
  const startSequence = async () => {
    if (!focusCard) return;
    // Automation always enrols the card's PRIMARY contact (its email is what the engine sends to). If the
    // user has retargeted the draft to an alternate contact, automating here would silently send to the
    // wrong person — steer them to Copy / Open email for the alternate instead.
    if (altContact) { setNotice(`“Automate” sends to ${focusCard.people.full_name} (the primary contact). To reach ${altContact.full_name}, use Copy or Open email and send it yourself.`); return; }
    // Guard against a second enrol (navigate away and back, then click again) creating a duplicate cadence.
    if (enrolledIds.has(focusCard.id)) { setNotice(`${focusCard.people.full_name} is already on the automated sequence.`); return; }
    const first = focusCard.people.full_name.split(/\s+/)[0] || "there";
    const subject = focusCard.email_subject || `Quick idea for ${focusCard.accounts.name}`;
    const body = focusCard.email_body || draftText;
    if (!body) { setNotice("No email draft yet — open the studio to write one first."); return; }
    const steps = [
      { day: 0, channel: "email", title: "Intro email", detail: "The opening email from the draft", subject, body },
      { day: 3, channel: "email", title: "Follow-up", detail: "A short bump", subject: `Re: ${subject}`, body: `Hi ${first},\n\nFloating this back up in case it slipped by. Happy to sketch out what we'd build for ${focusCard.accounts.name} to do that work instead of the hire. Worth a look?` },
      { day: 7, channel: "email", title: "Close", detail: "A brief sign-off", subject: `Re: ${subject}`, body: `Hi ${first},\n\nI'll leave it here for now. If building this instead of hiring for it becomes a priority, just reply and I'll pick it back up.` },
    ];
    setEnrolling(true);
    try {
      const response = await fetch(`/api/cards/${focusCard.id}/cadence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "automatic", stopOnReply: true, weekdaysOnly: true, sendWindow: "9:30–16:00", timeZone: "America/New_York", steps }) });
      const json = await response.json();
      if (!response.ok) { if (isMissing(json.error)) dropStaleCard(); else setNotice(json.error ?? "Could not start the sequence."); return; }
      setEnrolledIds((current) => new Set(current).add(focusCard.id));
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
    recordTouch("connection", text);
  };
  const copyText = async (text: string, label: string) => {
    if (!text.trim()) { setNotice("Nothing to copy yet — write or refine a draft first."); return; }
    try { await navigator.clipboard.writeText(text); setNotice(`${label} copied — paste it to send.`); }
    catch { setNotice("Copy was blocked by the browser; select the text to copy it."); }
  };
  // Copy only. A subsequent Send or Mark sent is required for history and analytics.
  const copyAndLog = async (channel: "email" | "linkedin") => {
    const text = channel === "email" && brief ? withOutreachName(adapt(emailDraft), { fromName: senderName }) : adapt(channel === "email" ? emailDraft : linkedinDraft);
    await copyText(text, channel === "email" ? "Email" : "LinkedIn message");
    // Copy is not evidence of a send. Only Send or Mark sent records an outcome.
  };
  // Mark a message sent when it went out elsewhere (e.g. an agent sent it) — logs the touch without opening/copying.
  const markSent = async (channel: "email" | "linkedin") => {
    const text = adapt(channel === "email" ? (focusCard?.email_body ?? emailDraft) : linkedinDraft);
    await recordTouch(channel === "email" ? "email" : "message", text);
  };
  // A subject is easy to wipe by accident (select-all, then a keystroke), and an email with no subject is
  // the one thing here that cannot be half-right. Remember what a card's subject was when the operator
  // started editing it, so it can be put straight back; if there is nothing to put back, the generated
  // subject stands in — the same one the send route already falls back to.
  // State, not a ref: the restore point is read while rendering (to label the button and fill the
  // placeholder), and a ref read during render is not reactive — the button would show a stale subject.
  const [subjectRestore, setSubjectRestore] = useState<Record<string, string>>({});
  const rememberSubject = (id: string, value: string) => {
    const trimmed = value.trim();
    if (trimmed) setSubjectRestore((current) => current[id] === trimmed ? current : { ...current, [id]: trimmed });
  };
  const subjectIsBlank = !(focusCard?.email_subject ?? "").trim();
  const subjectFallback = focusCard ? (subjectRestore[focusCard.id] || subjectGuess(focusCard, "email")) : "";
  const restoreSubject = (announce: boolean) => {
    if (!focusCard || !subjectFallback) return;
    editFocus("email_subject", subjectFallback);
    saveField("email_subject", subjectFallback);
    if (announce) setNotice(`Subject put back to “${subjectFallback}”.`);
  };

  // Set this subject on every un-sent email. Editing one draft USED to change others, because a write could
  // land on a different card than the one on screen; that was a bug and is fixed. The operator liked the
  // effect, so it is offered here as an explicit, confirmed action that touches subjects only.
  const [applyingSubject, setApplyingSubject] = useState(false);
  const applySubjectToAll = async () => {
    if (!focusCard || applyingSubject) return;
    const subject = (focusCard.email_subject ?? "").trim();
    if (!subject) { setNotice("Write a subject first, then apply it to every email."); return; }
    if (!confirm(`Use “${subject}” as the subject on every un-sent email? Each email's message is left exactly as it is.`)) return;
    if (demo) { setNotice("Demo mode — nothing was changed."); return; }
    setApplyingSubject(true);
    try {
      const before = new Date().toISOString();
      let total = 0;
      for (let i = 0; i < 60; i++) {
        const response = await fetch("/api/admin/apply-subject", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, before }) });
        const json = await response.json();
        if (!response.ok) { setNotice(json.error ?? "Could not apply the subject."); return; }
        total += json.applied ?? 0;
        setNotice(`Applying “${subject}” — ${total} so far…`);
        if (!json.remaining) break;
      }
      setCards((current) => current.map((item) => ["new", "approved", "edited"].includes(item.status) && item.email_body ? { ...item, email_subject: subject } : item));
      setNotice(`Subject set on ${total} un-sent email${total === 1 ? "" : "s"}. Every message body was left alone.`);
    } catch { setNotice("Could not apply the subject."); }
    finally { setApplyingSubject(false); }
  };
  // "Propose times": pull open slots from the connected calendar and drop them into the email draft to edit.
  // Strictly opt-in — nothing adds times on its own — and reversible, because it writes into the saved draft.
  const [proposing, setProposing] = useState(false);
  const timesInDraft = hasProposedTimes(focusCard?.email_body);
  // Take the times back out: off the draft AND off the card, so a reply can no longer auto-book against
  // times the operator has withdrawn.
  const removeMeetingTimes = async () => {
    if (!focusCard) return;
    const body = stripProposedTimes(focusCard.email_body);
    editFocus("email_body", body);
    saveField("email_body", body);
    if (!demo) await fetch(`/api/cards/${focusCard.id}/propose-times`, { method: "DELETE" }).catch(() => undefined);
    setNotice("Removed the proposed times. Nothing will be auto-booked from a reply for this prospect.");
  };
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
      editFocus("email_body", body);
      saveField("email_body", body);
      // Drop the composer's cached parse so the editor re-reads this new body; otherwise a blur would
      // reassemble from the stale pre-insert text and wipe the times just added.
      setNotice("Added open times from your calendar — edit as you like, then send. Didn't mean to? Press “Remove times” to take them back out.");
    } catch { setNotice("Could not reach your calendar."); }
    finally { setProposing(false); }
  };
  const [loadingReviewed, setLoadingReviewed] = useState(false);
  async function loadReviewedDraft() {
    if (!focusCard || loadingReviewed || altContact) return;
    const id = focusCard.id;
    setLoadingReviewed(true);
    try {
      const response = await fetch(`/api/cards/${id}/reviewed-draft`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "Could not load the reviewed draft."); return; }
      setCards(current => current.map(item => item.id === id && preservesCurrentDraft(item, focusCard) ? { ...item, email_subject: result.email_subject, email_body: result.email_body, status: result.status, assigned_to: result.assigned_to } : item));
      setLastRefine(null);
      setNotice(`Loaded the reviewed ${result.audience} draft with your sender settings.`);
    } catch { setNotice("Could not load the reviewed draft. Try again."); }
    finally { setLoadingReviewed(false); }
  }

  // Persist an inline edit to the focused card's draft field, and mark the prospect as being worked.
  /**
   * Saving a draft field marks the card EDITED, not just changed.
   *
   * Without that, "new" did not mean untouched — an operator could rewrite a whole email and the card still
   * read as freshly generated. The nightly pass keeps untouched drafts current with the writer, so it needs
   * to be able to tell the two apart; otherwise it either leaves stale prose in place forever or overwrites
   * somebody's own words. Only a card still awaiting a decision is promoted: an approved or sent one keeps
   * the status it earned.
   */
  const saveField = (key: "email_subject" | "email_body" | "linkedin_message" | "linkedin_subject", value: string) => {
    const promote = focusCard?.status === "new" ? { status: "edited" } : {};
    void patchFocus({ [key]: value, ...promote });
    markWorking(true);
  };
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
                <Link href="/outreach" className="coverage-tile is-ok">
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
              <div><span>OWNER</span><strong>{seatLabel(card.assigned_to)}</strong></div>
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
                sending={sending}
                demo={demo}
                gmailConnected={gmailConnected}
                sendReady={["approved", "edited"].includes(card.status)}
                onEdit={edit}
                onSave={() => patch({ status: "edited", email_subject: card.email_subject, email_body: card.email_body, linkedin_note: card.linkedin_note, linkedin_comment: card.linkedin_comment, linkedin_message: card.linkedin_message ?? "" })}
                onSend={() => void send(card)}
                onRecordTouch={(view, body) => recordTouch(view, body, card.people, card)}
                onNotice={setNotice}
              />

              <CadencePlanner
                key={card.id}
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
                    <div><dt>Assigned owner</dt><dd>{seatLabel(card.assigned_to)}</dd></div>
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
                <button type="button" role="tab" aria-selected={kind === "top"} className={kind === "top" ? "is-on" : ""} onClick={() => setKind("top")}>Selected companies <b>{Math.min(SHORTLIST, actionable.length)}</b></button>
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
            <div><span className="overview-kick">Your reach-out list</span><h1>Start the right conversation.</h1><p className="reachout-subtitle">{curatedDomains.length} operating companies · $10M to $100M annual revenue · Individual contact drafts</p></div>
            <div className="deskwork-head-right"><span>Night Watch</span><strong>{focusPool.length} companies to review</strong><div className="deskwork-head-actions">{tools}<button type="button" className="deskwork-overview" onClick={() => setBrowse(true)}>Overview &rarr;</button></div></div>
          </header>

          <div className="deskwork-grid">
            {/* LEFT — companies */}
            <aside className="deskwork-list">
              <div className="deskwork-list-head"><span>{listNeedle ? <>Matches <b>{listed.length}</b></> : <>Companies <b>{new Set(focusPool.map(item => item.accounts.domain)).size}</b></>}</span></div>
              <label className="reachout-sort-label">Sort by<select aria-label="Sort companies" className="reachout-sort" value={listSort} onChange={event => changeSort(event.target.value as ReachoutSort)}><option value="revenue-desc">Revenue: highest first</option><option value="revenue-asc">Revenue: lowest first</option><option value="name">Company: A to Z</option><option value="verified">Verified email first</option></select></label>
              <input className="deskwork-search" placeholder="Search a company, a person or a job title" value={query} onChange={(event) => setQuery(event.target.value)} />
              <div className="deskwork-list-scroll">
                {listed.map((item) => (
                  <button type="button" key={item.id} className={`deskwork-row ${focusCard && item.id === focusCard.id ? "is-active" : ""}`} onClick={() => pick(item.id)}>
                    <span className="avatar sm">{initials(item.accounts.name)}</span>
                    <span className="deskwork-row-id">
                      <strong>{item.accounts.name}</strong>
                      {/* Who, not just where. Several people at one company each have their own card now, so
                          without this the list repeats a company name and a search for a person finds a row
                          that does not say it found them. */}
                      <small className="deskwork-row-who">{item.people.full_name}{item.people.title ? ` · ${item.people.title}` : ""}</small>
                      <small>{revenueLabel(item.accounts.domain) ? `${revenueLabel(item.accounts.domain)} revenue · 2025` : signalLabel(item)}{item.working ? " · working" : ""}</small>
                    </span>
                    <span className={`reachout-email-dot ${item.people.email_status === "verified" ? "verified" : item.people.email ? "published" : "missing"}`} title={item.people.email_status === "verified" ? "Verified email" : item.people.email ? "Email needs verification" : "Email not found"} aria-label={item.people.email_status === "verified" ? "Verified email" : item.people.email ? "Email needs verification" : "Email not found"} />
                  </button>
                ))}
                {!!focusPool.length && listNeedle && !listed.length && <p className="deskwork-empty">Nothing here matches &ldquo;{query.trim()}&rdquo;. Try a shorter word, or part of an email address.</p>}
                {!focusPool.length && <p className="deskwork-empty">{listScope === "all" ? "No active prospects yet — new ones land here after the next scan." : "All caught up for today — switch to “All active” to work ahead, or new prospects land after the next scan."}</p>}
              </div>
            </aside>

            {focusCard && draft && contact ? (<>
              {/* MIDDLE — company, opening, people */}
              <section className="deskwork-mid">
                <header className="deskwork-co">
                  <span className="avatar">{initials(focusCard.accounts.name)}</span>
                  <div className="deskwork-co-name"><h2>{focusCard.accounts.name}{focusCard.isNew ? <em className="new-label">New</em> : focusCard.carriedOver ? <em className="chip carried">{carriedLabel(focusCard.created_at)}</em> : null}</h2><p>{signalLabel(focusCard)}{signalWhen(focusCard) ? ` · ${signalWhen(focusCard)}` : ""}</p></div>
                  <Link href="/outreach" className="focus-link">All {curatedDomains.length} companies</Link>
                </header>

                <div className="deskwork-opening">
                  {focusedAccount(focusCard.accounts.domain) && <div className="reachout-account-facts"><a href={focusedAccount(focusCard.accounts.domain)!.revenue.sourceUrl} target="_blank" rel="noreferrer"><strong>{revenueLabel(focusCard.accounts.domain)}</strong><span>2025 reported revenue ↗</span></a><span>{focusedAccount(focusCard.accounts.domain)!.sector}</span></div>}
                  <span className="overview-kick">{research ? "Buyer research" : "Signal context"}</span>
                  {research ? <>
                    <p className="deskwork-opening-lead">{research.trigger.fact}</p>
                    <p className="deskwork-opening-need"><b>Potential relevance:</b> {research.hypothesis}</p>
                    {!focusedAccount(focusCard.accounts.domain) && <p><b>{research.disposition === "hold" ? "Hold outreach" : "Fit assessment"}:</b> {research.fit}</p>}
                    <div className="reachout-sources"><a href={research.trigger.sourceUrl} target="_blank" rel="noreferrer">{sourceDomain(research.trigger.sourceUrl)} ↗</a>{research.buyer.sourceUrl !== research.trigger.sourceUrl && <a href={research.buyer.sourceUrl} target="_blank" rel="noreferrer">Leadership source ↗</a>}<small>{dateLabel(research.trigger.date) ? `Published ${dateLabel(research.trigger.date)} · ` : "Publication date not confirmed · "}Researched {dateLabel(research.researchDate)}</small></div>
                  </> : <>
                    <p className="deskwork-opening-lead">{sanitizeCopy(focusCard.signals.type === "job_cluster" || focusCard.signals.type === "job_post" ? focusCard.signals.summary : focusCard.why_now || nextLine(focusCard))}</p>
                    <p className="deskwork-opening-need">This signal needs buyer-level qualification. Hiring does not establish budget, an outsourcing need or a reason to replace the role.</p>
                  </>}
                  {focusCard.accounts.domain && <Link href={`/accounts/${focusCard.accounts.domain}`} className="focus-link">View signal &amp; company details &#8599;</Link>}
                </div>

                {focusCard.accounts.domain && <CompanyTeam key={`${focusCard.accounts.domain}:${teamStamp}`} compact domain={focusCard.accounts.domain} company={focusCard.accounts.name} activeId={altContact?.id ?? focusCard.people.id} busyId={openingContact} loggedIds={logged} onSelect={(person) => void openContact(person, focusCard)} />}
              </section>

              {/* RIGHT — draft with Email / LinkedIn tabs */}
              <section className="deskwork-draft">
                <div className="deskwork-draft-top"><span className="overview-kick">{sentAlready ? "Sent email" : "Outreach draft"}</span><span className="deskwork-draft-topright">{focusCard.invite_link ? <a className="deskwork-booked" href={focusCard.invite_link.startsWith("http") ? focusCard.invite_link : undefined} target="_blank" rel="noreferrer">📅 Meeting booked</a> : null}<a className="deskwork-brief-link" href={`/brief/${focusCard.id}`} target="_blank" rel="noreferrer">Call brief ↗</a></span></div>
                {!sentAlready && channelTab === "email" && <div className="notice" style={{ margin: "12px 16px" }}>
                  {research ? <>
                    <strong>{research.disposition === "hold" ? "Hold: buyer fit needs review." : "Written for this contact."}</strong>{" "}
                    {matchesResearch ? "Review and make it yours before sending." : "Your saved edits are preserved."}
                    {!matchesResearch && <button type="button" disabled={loadingReviewed || !!altContact} onClick={loadReviewedDraft}>{loadingReviewed ? "Loading…" : research.disposition === "hold" ? "Load optional partnership draft" : "Use researched draft"}</button>}
                  </> : <><strong>Not individually researched.</strong> This recipient is outside the named-buyer research set. Review the opening, relevance and proof before sending.</>}
                </div>}
                <div className="deskwork-draft-to">
                  <span className="avatar sm">{initials(contact.full_name)}</span>
                  <div><strong>{contact.full_name}</strong><small>{contact.title || "title unknown"} · {focusCard.accounts.name}</small></div>
                  {altContact
                    ? <button type="button" className="focus-who-reset" onClick={() => setAlt(null)}>&#8617; {focusCard.people.full_name.split(/\s+/)[0]}</button>
                    : cameFrom && cameFrom.cardId !== focusCard.id && cameFrom.company === focusCard.accounts.name
                      ? <button type="button" className="focus-who-reset" title={`Back to ${cameFrom.name}`} onClick={() => { setFocusId(cameFrom.cardId); setCameFrom(null); setNotice(""); }}>&#8617; {cameFrom.name.split(/\s+/)[0]}</button>
                      : <span className="deskwork-selected">Selected contact</span>}
                </div>

                <div className="deskwork-tabs">
                  <button type="button" className={`deskwork-tab ${channelTab === "email" ? "is-active" : ""}`} onClick={() => setChannelTab("email")}>✉ Email</button>
                  <button type="button" className={`deskwork-tab ${channelTab === "linkedin" ? "is-active" : ""}`} onClick={() => setChannelTab("linkedin")}><i className="li-mark">in</i> LinkedIn</button>
                  <div className="deskwork-tools">
                    {!sentAlready && <button type="button" title={editing[channelTab] ? "See exactly how it will go out" : "Edit this message"} onClick={() => setEditing((state) => ({ ...state, [channelTab]: !state[channelTab] }))}>{editing[channelTab] ? "Preview" : "Edit"}</button>}
                    {channelTab === "email" && !sentAlready && <button type="button" disabled={loadingReviewed || !!altContact} onClick={loadReviewedDraft}>{loadingReviewed ? "Loading…" : research ? "Researched draft" : "Company draft"}</button>}
                    {channelTab === "email" && <button type="button" disabled={proposing} title={timesInDraft ? "Take the proposed times back out of this email" : "Only if you want them: insert open times from your connected calendar into this one email"} onClick={timesInDraft ? removeMeetingTimes : proposeMeetingTimes}>{proposing ? "Checking…" : timesInDraft ? "Remove times" : "Propose times"}</button>}
                    <button type="button" disabled={busy} onClick={() => copyAndLog(channelTab)}>Copy</button>
                  </div>
                </div>

                {channelTab === "email" && !sentAlready && !altContact && savedVariants(focusCard.accounts.domain, contact.full_name).length > 0 && <section className="email-tone-controls" aria-label="Saved email versions">
                  <div className="email-tone-buttons"><strong>Saved versions</strong><Link href="/stats#saved-versions">Version analytics ↗</Link>{savedVariants(focusCard.accounts.domain, contact.full_name).map(variant => <button type="button" key={variant.id} disabled={busy} aria-pressed={tonePreview?.cardId === focusCard.id && tonePreview.label === variant.label} onClick={() => previewTone(variant)}>{variant.label}</button>)}</div>
                  <small>Already written for this contact. Preview and choose, no AI generation.</small>
                  {tonePreview?.cardId === focusCard.id && !altContact && <div className="email-tone-preview">
                    <strong>{tonePreview.label} version</strong>
                    <div className="email-tone-comparison"><div><small>Current</small><p><strong>{tonePreview.originalSubject}</strong></p><p>{outreachBody(tonePreview.original)}</p></div><div><small>Saved version</small><p><strong>{tonePreview.subject}</strong></p><p>{outreachBody(tonePreview.body)}</p><p>{senderName.trim().split(/\s+/)[0]}</p></div></div>
                    <button type="button" disabled={busy} onClick={applyTone}>Use this version</button>{" "}<button type="button" disabled={busy} onClick={() => setTonePreview(null)}>Keep current</button>
                  </div>}
                </section>}

                <div className="deskwork-scroll">
                {channelTab === "email" ? (
                  editing.email && !sentAlready ? (() => {
                    return (
                      <div className="deskwork-edit deskwork-compose">
                        <div className="compose-to"><span>To</span><b>{contact.email ?? `${contact.full_name} · no address on file`}</b></div>
                        <div className={`reachout-address-status ${contact.email_status === "verified" ? "verified" : ""}`}>
                          {contact.email_status === "verified" ? "Verified email" : contact.email ? "Published or saved address. Mailbox not verified." : "Email not found. This draft is ready to edit; add a confirmed address before sending."}
                          {contact.email && focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.email === contact.email && focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.emailSourceUrl && <a href={focusedContact(focusCard.accounts.domain ?? "", contact.full_name)!.emailSourceUrl!} target="_blank" rel="noreferrer">Address source ↗</a>}
                        </div>
                        <div className="focus-subject-row">
                          <input
                            className="focus-msg-subject"
                            value={emailStyle(focusCard.email_subject ?? "")}
                            placeholder={subjectFallback || "Subject line (optimized for a reply)"}
                            // The value as it stood before this edit is the restore point, so backspacing it
                            // away character by character brings back the whole line, not the last letter.
                            onFocus={(event) => rememberSubject(focusCard.id, event.target.value)}
                            onChange={(event) => editFocus("email_subject", emailStyle(event.target.value))}
                            // Leaving the field empty saves the subject back rather than saving a blank one.
                            onBlur={(event) => { if (event.target.value.trim()) saveField("email_subject", event.target.value); else restoreSubject(true); }}
                          />
                          {subjectIsBlank && subjectFallback
                            ? <button type="button" className="focus-apply-all" title={`Put the subject back: “${subjectFallback}”`} onClick={() => restoreSubject(false)}>Restore subject</button>
                            : <button type="button" className="focus-apply-all" disabled={applyingSubject} title="Use this subject on every un-sent email. Message bodies are not touched." onClick={applySubjectToAll}>{applyingSubject ? "Applying…" : "Apply to all"}</button>}
                        </div>
                        <label className="compose-field"><span>Email · your saved greeting and message</span><textarea className="focus-msg-body" rows={14} value={emailStyle(brief ? outreachBody(adapt(focusCard.email_body ?? "")) : adapt(focusCard.email_body ?? ""))} readOnly={!!altContact} onChange={(event) => editFocus("email_body", emailStyle(event.target.value))} onBlur={(event) => { if (!altContact) saveField("email_body", event.target.value); }} /></label>
                        <p className="compose-sig">{brief ? senderName.trim().split(/\s+/)[0] : senderName}</p>
                      </div>
                    );
                  })() : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head">
                        <div className="mail-row"><span>To</span><b>{contact.email ?? `${contact.full_name} · no address on file`}</b></div>
                        <div className="mail-row"><span>Subject</span><b>{subjectView("email", focusCard.email_subject || subjectGuess(focusCard, "email"))}</b></div>
                      </div>
                      {sentAlready && <div className="deskwork-sent-note">This email has been sent{focusCard.people.full_name ? ` to ${contact.full_name}` : ""}. It is kept here as a record &mdash; the follow-ups below are what happens next.</div>}
                      {diffFor("email") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("email", emailStyle(brief ? outreachBody(adapt(emailDraft)) : adapt(emailDraft)) || "No email draft yet. Choose a saved version or write your own.")}</div>
                      <div className="deskwork-doc-sig">{brief ? senderName.trim().split(/\s+/)[0] : senderName}</div>
                    </div>
                  )
                ) : (
                  editing.linkedin ? (
                    <div className="deskwork-edit">
                      <input className="focus-msg-subject" value={focusCard.linkedin_subject ?? ""} placeholder="Subject (used for InMail)" onChange={(event) => editFocus("linkedin_subject", event.target.value)} onBlur={(event) => saveField("linkedin_subject", event.target.value)} />
                      <textarea className="focus-msg-body" value={focusCard.linkedin_message ?? focusCard.linkedin_note ?? focusCard.linkedin_comment ?? ""} rows={11} placeholder="No LinkedIn message yet. Write your message here." onChange={(event) => editFocus("linkedin_message", event.target.value)} onBlur={(event) => saveField("linkedin_message", event.target.value)} />
                    </div>
                  ) : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head"><div className="mail-row"><span>Subject</span><b>{subjectView("linkedin", focusCard.linkedin_subject || subjectGuess(focusCard, "linkedin"))}</b></div></div>
                      {diffFor("linkedin") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("linkedin", adapt(linkedinDraft) || "No LinkedIn message yet. Write your message here.")}</div>
                    </div>
                  )
                )}

                {(() => {
                  const seq = (focusCard.followups ?? []).filter((f) => (channelTab === "email" ? f.channel === "email" : f.channel !== "email"));
                  if (seq.length === 0) {
                    return <div className="deskwork-fu-hint">Three follow-ups (spread over ~2 weeks, stopping the moment they reply) appear here once you send or copy this {channelTab === "email" ? "email" : "message"} — or press <b>Automate</b> below to have Night Watch send them for you.</div>;
                  }
                  // A cadence belongs to ONE contact, not to the company. Showing it unlabelled under
                  // whichever colleague was selected read as "emailing one person enrolled everybody".
                  const forName = seq.find((step) => step.forPerson)?.forPerson ?? "";
                  const forId = seq.find((step) => step.forPersonId)?.forPersonId ?? "";
                  const viewingSomeoneElse = Boolean(forId && contact && "id" in contact && contact.id && contact.id !== forId);
                  // Another contact's sequence folds away: you came here to write to the person selected, and
                  // three of somebody else's queued emails filled the panel instead.
                  if (viewingSomeoneElse) {
                    return <details className="deskwork-followups deskwork-fu-folded">
                      <summary>Follow-up sequence for {forName} &middot; {seq.length} queued</summary>
                      <div className="deskwork-fu-whose">These go to <strong>{forName}</strong>, the contact that email was sent to &mdash; not to {contact.full_name}. Nobody else at {focusCard.accounts.name} is on a sequence; send to {contact.full_name} and they get their own.</div>
                      {seq.map((step) => (
                        <div key={step.id} className={`deskwork-fu ${step.status === "sent" ? "is-done" : ""}`}>
                          <div className="deskwork-fu-top"><strong>Step {step.step} · {step.title}</strong><span>{followupWhen(step.scheduledAt, step.status)}</span></div>
                          {step.subject && <div className="deskwork-fu-subj">Subject: {step.subject}</div>}
                          <p className="deskwork-fu-body">{step.body}</p>
                        </div>
                      ))}
                    </details>;
                  }
                  return <div className="deskwork-followups">
                    <div className="deskwork-fu-head">Follow-up sequence{forName ? ` for ${forName}` : ""}<span>{seq.length} queued · “Automate” sends these for you, or copy each to send by hand · stops on a reply</span></div>
                    {seq.map((step) => (
                      <div key={step.id} className={`deskwork-fu ${step.status === "sent" ? "is-done" : ""}`}>
                        <div className="deskwork-fu-top"><strong>Step {step.step} · {step.title}</strong><span className={followupWhen(step.scheduledAt, step.status) === "due now" ? "is-due" : ""}>{followupWhen(step.scheduledAt, step.status)}</span></div>
                        {step.subject && <div className="deskwork-fu-subj">Subject: {step.subject}</div>}
                        <p className="deskwork-fu-body">{step.body}</p>
                        <div className="deskwork-fu-actions">
                          <button type="button" className="deskwork-fu-copy" onClick={() => copyText(step.subject ? `Subject: ${step.subject}\n\n${step.body}` : step.body, `Follow-up ${step.step}`)}>Copy follow-up</button>
                          {step.status === "pending" && step.channel === "email" && <button type="button" className="deskwork-fu-copy" disabled={!!sendingStep} title="Send this one now instead of waiting for its scheduled day" onClick={() => sendFollowupNow(step.id, step.title)}>{sendingStep === step.id ? "Sending…" : "Send now"}</button>}
                        </div>
                      </div>
                    ))}
                  </div>;
                })()}
                </div>

                <div className="deskwork-draft-foot">
                  <span className="deskwork-words">{(channelTab === "email" ? (focusCard.email_body ?? "") : linkedinDraft).trim().split(/\s+/).filter(Boolean).length} words</span>
                  <div className="deskwork-draft-actions">
                    {channelTab === "email"
                      // NOT disabled on `busy`: clicking here blurs the message box, which fires a save and
                      // sets busy, so the button disabled itself before the click landed and the first press
                      // was swallowed ("I have to click send twice"). send() guards re-entry itself.
                      ? <button type="button" disabled={sending || !contact.email} className="btn primary" onClick={sendEmail}>{sending ? "Sending…" : "Send email"} →</button>
                      : <button type="button" disabled={busy} className="btn primary" onClick={openLinkedIn}>Open LinkedIn →</button>}
                    <button type="button" disabled={busy} className="btn" title="Already sent (by you or the agent)? Log it to History without opening." onClick={() => markSent(channelTab)}>Mark sent</button>
                    {contact.email && <button type="button" disabled={enrolling} className="btn" title="Hands-off: Night Watch sends this email and its follow-ups for you (day 0, 3, 7) and stops the moment they reply. Prefer to send it yourself? Use “Send email” — the same follow-ups still queue in the list above for you to copy." onClick={startSequence}>{enrolling ? "Starting…" : "Automate"}</button>}
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
  const focused = focusedAccount(item.accounts.domain);
  if (focused) return dateLabel(focused.trigger.date) ? `published ${dateLabel(focused.trigger.date)}` : "date not confirmed";
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
  // Whole-word only, so a first name that's a substring of other words (e.g. "Al" in "already",
  // "Sam" in "same") can't mangle the rest of the draft.
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${escaped}\\b`, "g"), to);
}
