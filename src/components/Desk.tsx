"use client";
import { leftoverSourceNames, replaceOpening, retargetCopy } from "@/lib/bulk-copy";
import { autoSendLine, sentTodayLine, type AutoSendSeat } from "@/lib/auto-send-line";
import { bulkSendable, sendableAddress } from "@/lib/bulk-sendable";
import { acknowledgedDraftFields, DRAFT_TEXT_FIELDS, meetingTimesBody, resolveSaveConflict } from "@/lib/draft-save-state";
import { batchOwner, type ListSequence } from "@/lib/focus-data";
import type { AiFit } from "@/lib/ai-fit";
import { hydrateResearch } from "#research-data";
import type { ResearchData } from "@/lib/research-data/server";
import { batchProgress } from "@/lib/reachout-batches";
import { useRouter } from "next/navigation";
import { firstTouchFooterHtml, firstTouchErrors } from "@/lib/first-touch";
import { FirstTouchGuidance } from "@/components/FirstTouchGuidance";
import { curatedDomains } from "@/lib/curated-worklist";
import { accountBrief } from "@/lib/dossier-data";
import { dateLabel, sourceDomain } from "@/lib/dossier-data";
import { savedVariants, withDefaultLinkedIn, withDefaultEmail, renderSavedVariant, renderLinkedInVariant, type SavedVariant } from "@/lib/outreach-variants";
import { defaultReachoutSort, fitScore, focusedAccount, revenueLabel, revenueYearLabel, sendStateLabel, sortReachouts, reachoutPool, type ReachoutSort } from "@/lib/reachout-sort";
import { focusedContact } from "@/lib/focused-contact";
import { withResearchDefault } from "@/lib/recommended-draft";
import { researchRecommendation, contactEvidence, giftAsset } from "@/lib/research-recommendation";
import { authoredSenderDraft } from "@/lib/authored-sender";
import { outreachBody, withOutreachName } from "@/lib/outreach-ending";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { emailStyle } from "@/lib/email-style";
import { recipientResearch, hasResearchCopy } from "@/lib/recipient-research";
import { preservesCurrentDraft } from "@/lib/draft-update-policy";
import Link from "next/link";
import { runOutcome, type RunSummary } from "@/lib/run-status";
import { hasProposedTimes, sanitizeCopy, stripProposedTimes } from "@/lib/clean";
import { PRIORITY_THRESHOLD } from "@/lib/scoring";
import { TestEmailButton } from "./TestEmailButton";
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
  updated_at?: string | null;
  working_at?: string | null;
  working_by?: string | null;
  working?: boolean;
  isNew?: boolean;
  /** "Keep for me": the morning auto-send leaves this card for a person (migration 0030). */
  auto_send_hold?: boolean | null;
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

/** Today's list only: why the seat will not auto-send (null when it will), when each card was sent, and the window. */
export type AutoSendView = { blocker: string | null; sentAt: Record<string, string>; sendFrom: number; sendUntil: number; timeZone: string };

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

function personalizeCard(card: Card, senderName: string, senderGreeting: string): Card {
    if (!["new", "edited", "approved"].includes(card.status)) return withDefaultLinkedIn(card, senderName);
    const seeded = withResearchDefault(withDefaultEmail(withDefaultLinkedIn(card, senderName), senderGreeting), senderName, senderGreeting);
    const input = { domain: seeded.accounts.domain, contactName: seeded.people.full_name, senderName, greeting: senderGreeting };
    return { ...seeded,
      email_body: authoredSenderDraft({ ...input, body: seeded.email_body ?? "" }).body,
      linkedin_message: authoredSenderDraft({ ...input, body: seeded.linkedin_message ?? "", channel: "linkedin" }).body,
    };
}


const textFields = (row: Record<string, unknown>) => Object.fromEntries(DRAFT_TEXT_FIELDS.filter(key => key in row).map(key => [key, row[key] ?? ""]));

export function Desk({
  initialCards,
  senderName = "",
  senderIsViewer = true,
  senderGreeting = "Hi {first},",
  senderFooterHtml = "",
  selectedId,
  listHref = "/outreach",
  batchSequence,
  initialBrowse = false,
  autoAdvanceBatch = false,
  listOwner,
  batchCompletedDomains,
  demo = false,
  gmailConnected = false,
  context,
  scan,
  tools,
  researchSlice,
  autoSend,
}: {
  researchSlice?: ResearchData;
  autoSend?: AutoSendView;
  initialCards: Card[];
  senderName?: string;
  senderIsViewer?: boolean;
  senderGreeting?: string;
  senderFooterHtml?: string;
  selectedId?: string;
  listHref?: string;
  batchSequence?: ListSequence;
  initialBrowse?: boolean;
  autoAdvanceBatch?: boolean;
  listOwner?: 'josh' | 'suuchi';
  batchCompletedDomains?: string[];
  /** A page-level tool rendered in the desk header (Draft tools), passed in from the server page. */
  tools?: ReactNode;
  demo?: boolean;
  gmailConnected?: boolean;
  context?: DeskContext;
  scan?: import("react").ReactNode;
}) {
  // The research rows for this list arrive with the page instead of in the bundle. Load them before any
  // lookup below runs; on the server this is a no-op because the full set is already there.
  hydrateResearch(researchSlice);
  const [cards, setCards] = useState(() => initialCards.map(card => personalizeCard(card, senderName, senderGreeting)));
  const router = useRouter();
  const saveQueues = useRef(new Map<string, Promise<boolean>>());
  const revisions = useRef<Record<string, Record<string, number>>>({});
  const dirtyFields = useRef(new Set<string>());
  const serverVersions = useRef(new Map(initialCards.map(c => [c.id, c.updated_at])));
  // The draft text as this editor last read it from, or wrote it to, the server. A save that has to retry
  // compares against it to tell a background write (text untouched) from someone else's edit.
  const serverText = useRef(new Map<string, Record<string, unknown>>(initialCards.map(c => [c.id, textFields(c as unknown as Record<string, unknown>)])));
  const [saveState, setSaveState] = useState("Saved");
  const [conflict,setConflict]=useState<{id:string;saved?:{status:string;updated_at:string;email_subject:string;email_body:string;linkedin_subject:string;linkedin_message:string}}|null>(null);
  async function reviewConflict(id:string){
    try{const response=await fetch(`/api/cards/${id}`,{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error);setConflict({id,saved:data});}
    catch{setNotice('Could not load the saved copy. Your edits remain here. Try again.');}
  }
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirtyFields.current.size || saveQueues.current.size) { event.preventDefault(); event.returnValue = ""; } };
    const navigation = (event: MouseEvent) => {
      const link = (event.target as Element)?.closest('a[href]') as HTMLAnchorElement | null;
      if (!link || link.target === '_blank' || event.ctrlKey || event.metaKey || (!dirtyFields.current.size && !saveQueues.current.size)) return;
      event.preventDefault(); event.stopPropagation();
      void Promise.all([...saveQueues.current.values()]).then(() => {
        if (!dirtyFields.current.size || window.confirm("Some draft changes are not saved. Leave and discard those changes?")) window.location.assign(link.href);
      });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigation, true); };
  }, []);
  const advancing = useRef(false);
  const progress = listOwner ? batchProgress(listOwner, cards.map(card => ({ domain: card.accounts.domain ?? '', owner: card.assigned_to, status: card.status })), batchCompletedDomains) : null;
  useEffect(() => {
    if (demo || !autoAdvanceBatch || batchSequence !== 1 || !listOwner || advancing.current) return;
    if (progress?.sequence === 2) {
      advancing.current = true;
      router.refresh();
    }
  }, [progress?.sequence, batchSequence, autoAdvanceBatch, listOwner, demo, router]);
  useEffect(() => {
    const receive = (event: Event) => {
      const updates = (event as CustomEvent<Array<{ id: string; beforeStatus?: string; beforeSubject: string | null; beforeBody: string | null; subject: string; body: string; updated_at?: string }>>).detail;
      setCards(current => current.map(card => {
        const change = updates.find(update => update.id === card.id);
        if (!change) return card;
        // The repair pass wrote this row, so its version moved. Remember the new one even when the local
        // copy keeps its own text below: a save guarded on a version that no longer exists is rejected, and
        // the operator can then neither save nor send until they reload.
        if (change.updated_at) serverVersions.current.set(card.id, change.updated_at);
        // Never replace a local edit or a card sent while background repair was running. Compare against
        // the status the pass actually read, not a hardcoded "new" — an edited draft it legitimately
        // rewrote used to be treated as a local edit.
        if (!preservesCurrentDraft(card, { status: change.beforeStatus ?? card.status, email_subject: change.beforeSubject, email_body: change.beforeBody })) return card;
        return personalizeCard({ ...card, updated_at:change.updated_at??card.updated_at, email_subject: change.subject, email_body: change.body }, senderName, senderGreeting);
      }));
    };
    window.addEventListener("night-watch:draft-updates", receive);
    return () => window.removeEventListener("night-watch:draft-updates", receive);
  }, [senderName, senderGreeting]);

  // One-at-a-time by default: the desk opens on the next prospect to work, not a list.
  // `selected` = a full-detail deep dive; `browse` = the searchable list of everyone.
  const [selected, setSelected] = useState<string | undefined>(selectedId);
  // The one-at-a-time prospect flow is home; "All prospects" opens the full list on demand.
  const [browse, setBrowse] = useState(initialBrowse);
  const overviewHref = `${listHref}${listHref.includes("?") ? "&" : "?"}source=overview`;
  const [focusId, setFocusId] = useState<string | undefined>(selectedId ?? sortReachouts(initialCards, defaultReachoutSort(batchSequence))[0]?.id);
  const [listSort, setListSort] = useState<ReachoutSort>(defaultReachoutSort(batchSequence));
  const changeSort = (value: ReachoutSort) => {
    setListSort(value);
  };
  // Start on a tight worklist — the top prospects only — and let the chips widen it when it is cleared.
  const [kind, setKind] = useState<"top" | "all" | "job" | "social">(initialCards.length > SHORTLIST ? "top" : "all");
  // Drafts prepared after the page loaded arrive on the next server render (BatchPreparation refreshes the
  // route). Add any card not already on the desk; cards already here keep their local state, so an edit in
  // progress is never replaced by the refreshed copy.
  const [seenInitial, setSeenInitial] = useState(initialCards);
  if (seenInitial !== initialCards) {
    setSeenInitial(initialCards);
    const known = new Set(cards.map(card => card.id));
    const added = initialCards.filter(card => !known.has(card.id));
    if (added.length) {
      setCards(current => [...current, ...added.filter(card => !current.some(item => item.id === card.id)).map(card => personalizeCard(card, senderName, senderGreeting))]);
      if (!focusId) setFocusId(sortReachouts(added, listSort)[0]?.id);
      if (!cards.length && added.length > SHORTLIST) setKind("top");
    }
  }
  useEffect(() => {
    for (const card of initialCards) {
      if (!serverVersions.current.has(card.id)) serverVersions.current.set(card.id, card.updated_at);
      if (!serverText.current.has(card.id)) serverText.current.set(card.id, textFields(card as unknown as Record<string, unknown>));
    }
  }, [initialCards]);
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
  const sendInFlight = useRef(false);
  const [tonePreview, setTonePreview] = useState<{ channel: "email" | "linkedin"; cardId: string; versionId: string; label: string; original: string; originalSubject: string; subject: string; body: string } | null>(null);
  function previewTone(variant: SavedVariant) {
    if (!focusCard || altContact) return;
    const draft = channelTab === "linkedin" ? renderLinkedInVariant(variant, senderName) : renderSavedVariant(variant, focusCard.people.full_name, senderName, senderGreeting);
    setTonePreview({ channel: channelTab, cardId: focusCard.id, versionId: variant.id, label: variant.label, original: (channelTab === "email" ? focusCard.email_body : focusCard.linkedin_message) ?? "", originalSubject: (channelTab === "email" ? focusCard.email_subject : focusCard.linkedin_subject) ?? "", ...draft });
  }
  async function applyTone() {
    if (sending || sendInFlight.current || !tonePreview || !focusCard || tonePreview.cardId !== focusCard.id || tonePreview.channel !== channelTab) return;
    if (((channelTab === "email" ? focusCard.email_body : focusCard.linkedin_message) ?? "") !== tonePreview.original || ((channelTab === "email" ? focusCard.email_subject : focusCard.linkedin_subject) ?? "") !== tonePreview.originalSubject) {
      setNotice("You edited the draft. Review the saved version again before replacing your latest text.");
      setTonePreview(null);
      return;
    }
    try {
      const saved = await patchOn(focusCard.id, { saved_variant_id: tonePreview.versionId, saved_variant_channel: channelTab, ...(channelTab === "email" ? { email_subject: tonePreview.subject, email_body: tonePreview.body } : { linkedin_subject: tonePreview.subject, linkedin_message: tonePreview.body }), status: "edited" });
      if (saved) setTonePreview(null);
    } catch { setNotice("Could not save this version. Your original is unchanged."); }
  }
  // Open the composer in edit mode so every email/message is directly editable before sending;
  // the tools row flips it to a read-only "Preview" of exactly how it will go out.
  const [editing, setEditing] = useState<{ email: boolean; linkedin: boolean }>({ email: true, linkedin: true });

  const [lastRefine, setLastRefine] = useState<{ cardId: string; channel: "email" | "linkedin"; beforeBody: string; afterBody: string; beforeSubject: string; afterSubject: string } | null>(null);
  const [channelTab, setChannelTab] = useState<"email" | "linkedin">("email");
  useEffect(() => {
    const openEditor = () => { setChannelTab("email"); setTonePreview(null); setEditing(current => ({ ...current, email: true })); };
    window.addEventListener("nightwatch:tour-edit", openEditor);
    return () => window.removeEventListener("nightwatch:tour-edit", openEditor);
  }, []);
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
  const sortedPool = sortReachouts(reachoutPool(cards, listScope === "all" ? actionable : todo), listSort);
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
  // "suuchi" is a seat, not a person: the operator on it is Suuchi. Show the name that seat sends as,
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
    if (sendInFlight.current) { setNotice("Wait for the send result before changing this draft."); return false; }
    if (demo) {
      setCards((current) => current.map((item) => item.id === cardId ? { ...item, ...values } : item));
      setNotice("Demo updated locally — nothing was saved or sent.");
      return true;
    }
    const submitted = { ...(revisions.current[cardId] ?? {}) };
    Object.keys(values).forEach(key => dirtyFields.current.add(`${cardId}:${key}`));
    setSaveState("Saving…");
    const prior = saveQueues.current.get(cardId) ?? Promise.resolve(true);
    const task = prior.then(async () => {
      try {
        const write = (version: string | null | undefined) => fetch(`/api/cards/${cardId}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...values, expected_updated_at: version }),
        });
        let response = await write(serverVersions.current.get(cardId));
        let json = await response.json();
        // The row moved between loading it and saving. Background work — the nightly rescore, the draft
        // repair pass that runs on every page load, worklist stamping — writes to cards while somebody is
        // typing, and every write bumps the version this save is guarded on. Left alone, that save fails
        // until the page is reloaded, which also blocks sending, since the composer refuses to send with an
        // unsaved field. Read the stored copy and, if the draft can still be written to, save again over it
        // and say so when the stored text differed. A card that has been sent is a real conflict: it keeps
        // the banner and is never written over.
        let replacedStoredCopy = false;
        if (response.status === 409) {
          const saved = await fetch(`/api/cards/${cardId}`, { cache: "no-store" }).then(r => r.ok ? r.json() : null).catch(() => null);
          const resolution = resolveSaveConflict(values, saved, serverText.current.get(cardId));
          if (resolution.retry) {
            response = await write(resolution.version);
            json = await response.json();
            replacedStoredCopy = resolution.replaced && response.ok;
          } else if (saved) setConflict({ id: cardId, saved });
        }
        if (!response.ok) { if(response.status===409)setConflict(current=>current?.id===cardId?current:{id:cardId});setSaveState("Save failed"); setNotice(`Not saved: ${json.error ?? "Please retry. Your text remains on screen."}`); return false; }
        if (replacedStoredCopy) setNotice("Saved. Your text replaced a copy of this draft that had changed since you opened it.");
        if (json.updated_at) serverVersions.current.set(cardId, json.updated_at);
        serverText.current.set(cardId, { ...serverText.current.get(cardId), ...textFields(values), ...textFields(Object.fromEntries(Object.keys(values).filter(key => key in json).map(key => [key, json[key]]))) });
        if(conflict?.id===cardId)setConflict(null);
        const acknowledged = acknowledgedDraftFields(values, json, submitted, revisions.current[cardId] ?? {});
        if(json.restored || values.reopen)acknowledged.status=json.status;
        // Restore explicitly recovers blank stored copy; regular saves only acknowledge submitted fields.
        if (values.reopen) for (const key of ["status", "email_body", "email_subject"]) if (json[key] !== undefined && !(revisions.current[cardId]?.[key])) acknowledged[key] = json[key];
        setCards(current => current.map(item => item.id === cardId ? { ...item, ...acknowledged } : item));
        Object.keys(values).forEach(key => { if ((submitted[key] ?? 0) === (revisions.current[cardId]?.[key] ?? 0)) dirtyFields.current.delete(`${cardId}:${key}`); });
        setSaveState(dirtyFields.current.size ? "Unsaved changes" : "Saved");
        return true;
      } catch { setSaveState("Save failed"); setNotice("Not saved: connection interrupted. Your text remains on screen. Retry saving before leaving."); return false; }
    });
    saveQueues.current.set(cardId, task);
    void task.finally(() => { if (saveQueues.current.get(cardId) === task) saveQueues.current.delete(cardId); });
    return task;
  }

  const [holdBusy, setHoldBusy] = useState(false);
  /** "Keep for me": take a card off the morning auto-send without dismissing it. Sending by hand still works. */
  async function toggleHold(cardId: string, hold: boolean) {
    setHoldBusy(true);
    try {
      if (await patchOn(cardId, { auto_send_hold: hold })) setNotice(hold ? "Kept for you: the morning auto-send will skip this company." : "Back on the morning auto-send.");
    } finally { setHoldBusy(false); }
  }

  /** Write to the dossier's card (the one the dossier view renders). */
  const patch = (values: Record<string, unknown>) => patchOn(card.id, values);
  /** Write to the prospect the one-at-a-time desk is showing. */
  const patchFocus = (values: Record<string, unknown>) => patchOn(focusCard?.id ?? card.id, values);

  // `target` is the prospect being sent to, and callers always pass it: this read `card`
  // (active ?? focusCard) while the desk's Send button lives in the focusCard composer, so a stale
  // `selected` would have confirmed one name and emailed a different person entirely.
  async function send(target?: Card, to?: { id?: string; full_name: string; email: string | null; email_status?: string }, bodyOverride?: string) {
    if (!senderIsViewer) { setNotice(`Sign in as ${senderName} to send from this list.`); return; }
    const onCard = target ?? card;
    // Who the email is actually addressed to: the card's own contact, or the colleague picked from the
    // company's team list. The server re-checks that person is at the same company.
    const who = to ?? onCard?.people;
    if (sendInFlight.current || sending || !onCard || !who) return; // re-entry guard, since the button is no longer disabled by `busy`
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
    const submittedRevision = JSON.stringify(revisions.current[onCard.id] ?? {});
    sendInFlight.current = true;
    setNotice("");
    setSending(true);
    // A subject is required server-side; fall back rather than fail with a raw validation error.
    const subject = (onCard.email_subject ?? "").trim() || subjectGuess(onCard, "email");
    try {
    await saveQueues.current.get(onCard.id);
    if (submittedRevision !== JSON.stringify(revisions.current[onCard.id] ?? {})) { setNotice("The draft changed while preparing the send. Review the latest text, then send again."); return; }
    if ([...dirtyFields.current].some(key => key.startsWith(`${onCard.id}:`))) { setNotice("Not sent: this draft still has unsaved changes. Press “Save changes” above the message, then send."); return; }
    const response = await fetch(`/api/cards/${onCard.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject, body: bodyOverride ?? onCard.email_body, personId: who && "id" in who ? who.id : undefined }),
    });
    const json = await response.json();
    if (!response.ok) { if (isMissing(json.error)) dropStaleCard(); else setNotice(json.code === "delivery_unknown" || json.code === "delivery_reserved" ? json.error : `Not sent: ${json.error ?? "Send failed."}`); return; }
    if (!json.ok || !json.threadId) throw new Error("Missing Gmail confirmation");
    setCards((current) => current.map((item) => item.id === onCard.id ? { ...item, status: "sent" } : item));
    // Mark the recipient in the team list straight away, so it is obvious who has already been written to
    // without waiting for a reload.
    if (who && "id" in who && who.id) setLogged((current) => new Set(current).add(who.id as string));
    setNotice(json.warning ?? `Sent to ${json.to ?? who.full_name}${json.from ? ` from ${json.from}` : ''}. Gmail confirmed the send. You can find it in that mailbox’s Sent folder and in History.`);
    } catch {
      setNotice("Send status unknown: the connection was interrupted. Check Gmail Sent and History before retrying to avoid a duplicate.");
    } finally { sendInFlight.current = false; setSending(false); }
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
    try {
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
    const fresh = personalizeCard(json.card as Card, senderName, senderGreeting);
    if (fresh.updated_at) serverVersions.current.set(fresh.id, fresh.updated_at);
    setCards((current) => current.some((item) => item.id === fresh.id) ? current.map((item) => item.id === fresh.id ? { ...item, ...fresh } : item) : [...current, fresh]);
    setAlt(null);
    setCameFrom({ cardId: from.id, name: from.people.full_name, company: from.accounts.name });
    setFocusId(fresh.id);
    setNotice(json.existing ? `Writing to ${person.full_name} — this is their own draft.` : `Wrote ${person.full_name} their own email, aimed at what their role owns.`);
    } catch { setNotice("Could not open the contact. Check your connection and try again."); } finally { setOpeningContact(null); }
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
    try {
    const channel = view === "email" ? "email" : view === "comment" ? "linkedin_comment" : view === "message" ? "linkedin_message" : "linkedin_request";
    const response = await fetch(`/api/cards/${onCard.id}/touch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel, body, personId, subject: view === "email" ? (cards.find(item => item.id === onCard.id)?.email_subject ?? "") : view === "message" ? (cards.find(item => item.id === onCard.id)?.linkedin_subject ?? "") : undefined }) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { if (isMissing(result.error)) dropStaleCard(); else setNotice(result.error ?? "Unable to record outreach."); return; }
    // Keep the company on the desk (don't mark the card sent) so its other contacts can still be logged.
    if (personId) setLogged((current) => new Set(current).add(personId));
    setNotice(`Logged ${label.toLowerCase()} to ${who?.full_name ?? "the contact"} — it's in History now.`);
    } catch { setNotice("Could not confirm the history update. Check History before retrying."); } finally { setBusy(false); }
  }

  async function recordOutcome() {
    if (demo) {
      const status = outcome === "meeting" ? "meeting" : ["positive", "referral"].includes(outcome) ? "positive" : "replied";
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status } : item));
      setNotice("Outcome recorded in demo mode.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/cards/${card.id}/outcome`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcome }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setNotice(result.error ?? "Unable to record outcome."); return; }
      setCards((current) => current.map((item) => item.id === card.id ? { ...item, status: result.status } : item));
      setNotice("Outcome recorded. Signal and message analytics have been updated.");
    } catch {
      setNotice("Not recorded: the connection was interrupted. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const editOn = (cardId: string, key: string, value: string) => {
    if (sendInFlight.current) return;
    revisions.current[cardId] ??= {};
    revisions.current[cardId][key] = (revisions.current[cardId][key] ?? 0) + 1;
    dirtyFields.current.add(`${cardId}:${key}`); setSaveState("Unsaved changes");
    setCards(current => current.map(item => item.id === cardId ? { ...item, [key]: value } : item));
  };
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
  const recommendation = focusCard && contact ? researchRecommendation(focusCard.accounts.domain, contact.full_name) : null;
  const availableVersions = focusCard && contact ? savedVariants(focusCard.accounts.domain, contact.full_name, channelTab) : [];
  const selectedVersion = availableVersions.find(v => {
    const rendered = channelTab === "email" ? renderSavedVariant(v, contact!.full_name, senderName, senderGreeting) : renderLinkedInVariant(v, senderName);
    return rendered.subject === (channelTab === "email" ? focusCard?.email_subject : focusCard?.linkedin_subject) && rendered.body === (channelTab === "email" ? focusCard?.email_body : focusCard?.linkedin_message);
  });
  const previewingVersion = tonePreview?.channel === channelTab && !!tonePreview && tonePreview.cardId === focusCard?.id && !altContact;
  const priorResearch = recipientResearch(focusCard?.accounts.domain, contact?.full_name);
  const evidence = contactEvidence(focusCard?.accounts.domain, contact?.full_name);
  const asset = evidence ? giftAsset(evidence.giftId) : undefined;
  const research = priorResearch && asset ? { ...priorResearch, trigger: evidence?.trigger ? {fact:evidence.trigger.fact,sourceUrl:evidence.trigger.sourceUrl,date:evidence.trigger.publishedDate} : asset.source, researchDate:asset.preparedAt, hypothesis:`Proposed first test: ${asset.title}. ${asset.scope}` } : priorResearch;
  // One line of why this company is on the list: the top fit reasons, or the research trigger.
  const whyText = (() => {
    if (!focusCard) return null;
    const fit = (focusedAccount(focusCard.accounts.domain) as { aiFit?: AiFit } | undefined)?.aiFit;
    const reasons = fit && !fit.disqualified ? fit.reasons.slice(0, 2).map((reason) => reason.text) : [];
    return reasons.length ? reasons.join(" · ") : research?.trigger.fact ?? null;
  })();
  const addressConfirmed = (person: { email?: string | null }) => bulkSendable(person as unknown as Parameters<typeof bulkSendable>[0]);
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
  const senderConflict = focusCard && authoredSenderDraft({ body: channelTab === "email" ? emailDraft : focusCard.linkedin_message ?? "", domain: focusCard.accounts.domain, contactName: focusCard.people.full_name, senderName, greeting: senderGreeting, channel: channelTab }).senderConflict;
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
    if (!senderIsViewer) { setNotice(`Sign in as ${senderName} to send this follow-up.`); return; }
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
    if (!senderIsViewer) { setNotice(`Sign in as ${senderName} to send from this list.`); return; }
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
      { day: 3, channel: "email", title: "Follow-up", detail: "A short bump", subject: `Re: ${subject}`, body: `Hi ${first},\n\nFollowing up on the project I suggested for ${focusCard.accounts.name}. We'd build a first version with the people doing the work and test whether it saves them time. Is this worth exploring?` },
      { day: 7, channel: "email", title: "Close", detail: "A brief sign-off", subject: `Re: ${subject}`, body: `Hi ${first},\n\nI'll leave this with you after this note. Our engineers can help from the first build through testing and training. Would it be better to revisit this later?` },
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
    let copied = false;
    try { await navigator.clipboard.writeText(text); copied = true; } catch { /* Tell the user to copy manually. */ }
    const href = linkedInHref();
    if (href) window.open(href, "_blank", "noopener,noreferrer");
    setNotice(copied ? "Message copied. Paste it in LinkedIn, then use Mark sent after sending." : "LinkedIn opened. Copy the message manually, then use Mark sent after sending.");
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
  const [bulkOpening, setBulkOpening] = useState("");
  const [applyingOpening, setApplyingOpening] = useState(false);
  const [applyingMessage, setApplyingMessage] = useState(false);
  const [bulkUndo, setBulkUndo] = useState<Array<{id:string; field:string; before:string; after:string}>>([]);
  async function undoBulk() {
    if (!bulkUndo.length || !confirm(`Undo the last batch edit on ${bulkUndo.length} drafts? Drafts edited since will be skipped.`)) return;
    let restored = 0;
    for (const row of bulkUndo) {
      const current = cards.find(c => c.id === row.id);
      if (!current || (current as unknown as Record<string, unknown>)[row.field] !== row.after) continue;
      if (await patchOn(row.id, { [row.field]: row.before })) restored++;
    }
    setBulkUndo([]); setNotice(`Restored ${restored} drafts. Later changes were preserved.`);
  }
  /** Save whatever is still being typed on the open draft, then wait for every save in flight. Clicking a
   *  batch button takes focus out of the field, which starts a save; refusing because of that save is what
   *  made "Apply to this batch" do nothing every time. */
  async function flushPendingSaves() {
    const open = focusCard;
    if (open) {
      const pending = ["email_subject", "email_body"].filter(key => dirtyFields.current.has(`${open.id}:${key}`));
      if (pending.length) await patchOn(open.id, Object.fromEntries(pending.map(key => [key, (open as unknown as Record<string, unknown>)[key] ?? ""])));
    }
    await Promise.all([...saveQueues.current.values()]);
    return dirtyFields.current.size === 0;
  }
  const applyCopyToAll = async (field: "subject" | "message" | "opening") => {
    if (sending || sendInFlight.current || bulkSending || !focusCard || applyingSubject || applyingOpening || applyingMessage) return;
    const source = focusCard;
    const value = (field === "subject" ? source.email_subject ?? "" : field === "message" ? source.email_body ?? "" : bulkOpening).trim();
    if (!value) { setNotice(`Write ${field === "subject" ? "a subject" : field === "message" ? "a message" : "an opening"} first.`); return; }
    const owner = batchOwner(source.accounts.domain ?? "");
    const targets = cards.filter(c => c.id !== source.id && ["new","edited","approved"].includes(c.status) && batchOwner(c.accounts.domain ?? "") === owner && c.email_body?.trim());
    if (!owner) return;
    if (!targets.length) { setNotice("There are no other unsent drafts in this list to apply it to."); return; }
    if (!(await flushPendingSaves())) { setNotice("Your edit could not be saved, so nothing was applied. Press “Save changes”, then try again."); return; }
    const what = field === "subject" ? "subject line" : field === "message" ? "message" : "opening paragraph";
    const personalized = field === "opening" ? "Each greeting and the rest of each message stay as they are." : `Each company's name${field === "message" ? " and each person's first name in the greeting" : ""} is swapped in automatically.`;
    if (!window.confirm(`Use this ${what} on the other ${targets.length} unsent drafts in ${owner === "josh" ? "Josh" : "Suuchi"}'s ${batchSequence === 3 ? "list for today" : batchSequence === 2 ? "Next 25" : "First 25"}?\n\n${value.slice(0, 400)}\n\n${personalized} You can undo it afterwards.`)) return;
    const setApplying = field === "subject" ? setApplyingSubject : field === "message" ? setApplyingMessage : setApplyingOpening;
    setApplying(true);
    try {
      if (demo) { setNotice("Bulk changes are disabled in the local preview."); return; }
      const key = field === "subject" ? "email_subject" : "email_body";
      const from = { company: source.accounts.name, person: source.people.full_name };
      const changes = targets.map(c => {
        const to = { company: c.accounts.name, person: c.people.full_name };
        const after = field === "opening" ? replaceOpening(c.email_body ?? "", value) : retargetCopy(value, from, to, field === "message");
        return { id: c.id, field: key, before: (field === "subject" ? c.email_subject : c.email_body) ?? "", after };
      });
      for (const change of changes) {
        const target = targets.find(c => c.id === change.id)!;
        if (field !== "opening") {
          const leftover = leftoverSourceNames(change.after, from, { company: target.accounts.name, person: target.people.full_name });
          if (leftover.length) throw new Error(`Nothing was applied: this ${what} mentions “${leftover[0]}”, which belongs to ${from.company ?? "this company"}${leftover[0] === (from.person ?? "").trim().split(/\s+/)[0]?.toLowerCase() ? " (the person's first name)" : ""}, and it would appear in ${target.accounts.name}'s email. Write the company's name exactly as “${(from.company ?? "").split(" / ")[0]}” (it is swapped automatically), or remove the name, then apply again.`);
        }
        const errors = firstTouchErrors(field === "subject" ? change.after : target.email_subject ?? "", field === "subject" ? target.email_body ?? "" : change.after);
        if (errors.length) throw new Error(`${target.accounts.name}: ${errors[0]}`);
      }
      if (changes.some(c => c.after.length > (field === "subject" ? 120 : 1000))) throw new Error("This edit exceeds a draft's character limit. Shorten it before applying.");
      const applied: typeof changes = [];
      for (const change of changes) if (await patchOn(change.id, { [key]: change.after, status: "edited" })) applied.push(change);
      setBulkUndo(applied);
      setNotice(applied.length === targets.length ? `Applied to all ${targets.length} other unsent drafts. “Undo last batch edit” puts them back.` : `Applied to ${applied.length} of ${targets.length} drafts; ${targets.length - applied.length} changed elsewhere and were left alone. “Undo last batch edit” puts the applied ones back.`);
    } catch(error) {setNotice(error instanceof Error ? error.message : "Could not update drafts.");}
    finally {setApplying(false);}
  };
  const applySubjectToAll = () => applyCopyToAll("subject");
  const applyMessageToAll = () => applyCopyToAll("message");

  // Send every ready draft in this list, one at a time, through the same send route (and so the same daily
  // cap, recipient, do-not-contact and duplicate checks) as the Send button. Only verified addresses go out
  // this way; the rest are left for a person to send one by one after the per-email warning.
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ total: number; sent: number; failed: Array<{ name: string; error: string }>; current: string } | null>(null);
  const bulkStop = useRef(false);
  const [autoSeats, setAutoSeats] = useState<Array<AutoSendSeat & { owner: string }>>([]);
  // Re-read after every send so the counter and the auto-send line stay current.
  const sentOnDesk = cards.filter(c => c.status === "sent").length;
  useEffect(() => {
    if (demo) return;
    let live = true;
    fetch("/api/settings/auto-send").then(response => response.ok ? response.json() : null).then((json: { seats?: Array<AutoSendSeat & { owner: string }> } | null) => { if (live && json?.seats) setAutoSeats(json.seats); }).catch(() => {});
    return () => { live = false; };
  }, [sentOnDesk, demo]);
  // Her own switch: turning auto-send on or off (or resuming after a pause) from the desk, without Settings.
  async function setAutoSend(owner: string, change: { autoSend?: boolean; paused?: boolean }, waiting: number) {
    if (change.autoSend === true && !window.confirm(`Turn on auto-send?\n\nEvery weekday between 9:00 and 11:30am Eastern, your unsent drafts (${waiting} now) go out on their own, spaced apart, up to your daily limit. Unconfirmed addresses go too, so a few may bounce; auto-send pauses itself if bounces pile up.\n\nYou can turn it off here at any time.`)) return;
    const response = await fetch("/api/settings/auto-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, ...change }) });
    const json = await response.json().catch(() => ({})) as { seat?: AutoSendSeat & { owner: string }; error?: string };
    if (!response.ok || !json.seat) { setNotice(json.error ?? "Could not change auto-send. Try again in Settings."); return; }
    const seat = json.seat;
    setAutoSeats(current => current.map(item => item.owner === owner ? seat : item));
    setNotice(seat.autoSend && !seat.paused ? "Auto-send is on. Your drafts go out each weekday morning between 9:00 and 11:30am." : "Auto-send is off. Nothing goes out unless you send it.");
  }
  async function skipAutoSendToday(owner: string) {
    const response = await fetch("/api/settings/auto-send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner, skipToday: true }) });
    const json = await response.json().catch(() => ({})) as { seat?: AutoSendSeat & { owner: string }; error?: string };
    if (!response.ok || !json.seat) { setNotice(json.error ?? "Could not skip today's auto-send. Try again in Settings."); return; }
    const seat = json.seat;
    setAutoSeats(current => current.map(item => item.owner === owner ? seat : item));
    setNotice("Auto-send is skipped for today. Nothing goes out automatically until the next send day.");
  }
  // The seat whose list is open (or, with none open, every seat the viewer may see): always on screen, above the list.
  const waitingFor = (owner: string) => cards.filter(c => c.assigned_to === owner && ["new","edited","approved"].includes(c.status) && c.email_subject?.trim() && c.email_body?.trim() && sendableAddress(c.people as unknown as Parameters<typeof sendableAddress>[0])).length;
  const barSeats = autoSeats.filter(seat => !listOwner || seat.owner === listOwner);
  const autoSendBar = barSeats.length > 0 && !demo ? (
    <div className="autosend-bar" aria-label="Auto-send">
      {barSeats.map(seat => {
        const waiting = waitingFor(seat.owner);
        const line = autoSendLine(seat, waiting);
        const on = seat.autoSend && !seat.paused;
        return (
          <div className="autosend-seat" key={seat.owner}>
            {barSeats.length > 1 && <b className="autosend-who">{context?.seatNames?.[seat.owner] ?? (seat.owner === "josh" ? "Josh" : "Suuchi")}</b>}
            {seat.autoSend && seat.paused
              ? <button type="button" className="autosend-switch is-paused" onClick={() => void setAutoSend(seat.owner, { paused: false }, waiting)}><span className="autosend-knob" />Paused · Resume</button>
              : <button type="button" role="switch" aria-checked={on} className={`autosend-switch ${on ? "is-on" : ""}`} onClick={() => void setAutoSend(seat.owner, { autoSend: !seat.autoSend }, waiting)}><span className="autosend-knob" />Auto-send {on ? "On" : "Off"}</button>}
            <span className="autosend-text">{line.text}</span>
            {line.canSkip && <button type="button" className="btn ghost autosend-skip" onClick={() => void skipAutoSendToday(seat.owner)}>Skip today</button>}
            <span className="autosend-count">{sentTodayLine(seat)}</span>
          </div>
        );
      })}
    </div>
  ) : null;
  const readyToSend = (owner: string | null) => cards.filter(c => ["new","edited","approved"].includes(c.status) && batchOwner(c.accounts.domain ?? "") === owner && c.email_subject?.trim() && c.email_body?.trim() && c.people.email);
  async function sendAllReady() {
    if (!focusCard || bulkSending || sending || sendInFlight.current) return;
    if (!senderIsViewer) { setNotice(`Sign in as ${senderName} to send from this list.`); return; }
    if (demo) { setNotice("Sending is disabled in the local preview."); return; }
    const owner = batchOwner(focusCard.accounts.domain ?? "");
    if (!(await flushPendingSaves())) { setNotice("An edit could not be saved, so nothing was sent. Press “Save changes”, then try again."); return; }
    const all = readyToSend(owner);
    const verified = all.filter(c => sendableAddress(c.people as unknown as Parameters<typeof sendableAddress>[0]));
    const unconfirmed = verified.filter(c => !addressConfirmed(c.people)).length;
    const others = all.length - verified.length;
    if (!verified.length) { setNotice(others ? `None of the ${others} unsent drafts has a usable address: each is missing one or bounced before.` : "Nothing is left to send in this list."); return; }
    if (!window.confirm(`Send ${verified.length} email${verified.length === 1 ? "" : "s"} now from ${senderName}?\n\nThey go out one at a time, about 10 seconds apart, exactly as written. Your daily sending limit still applies, and you can press Stop at any time. Keep this tab open until it finishes.${unconfirmed ? `\n\n${unconfirmed} of them ${unconfirmed === 1 ? "has an" : "have"} unconfirmed address${unconfirmed === 1 ? "" : "es"}, so a few may bounce. Auto-send pauses itself if bounces pile up.` : ""}${others ? `\n\n${others} draft${others === 1 ? " has" : "s have"} no usable address and will be skipped.` : ""}`)) return;
    bulkStop.current = false;
    sendInFlight.current = true;
    setBulkSending(true);
    const progress = { total: verified.length, sent: 0, failed: [] as Array<{ name: string; error: string }>, current: "" };
    setBulkProgress({ ...progress });
    try {
      for (const [index, item] of verified.entries()) {
        if (bulkStop.current) break;
        progress.current = `${item.people.full_name}, ${item.accounts.name}`;
        setBulkProgress({ ...progress });
        try {
          const response = await fetch(`/api/cards/${item.id}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: item.email_subject, body: item.email_body }) });
          const json = await response.json().catch(() => ({}));
          if (response.ok && json.ok && json.threadId) {
            progress.sent += 1;
            setCards(current => current.map(card => card.id === item.id ? { ...card, status: "sent" } : card));
          } else {
            const error = String(json.error ?? "Send failed.");
            progress.failed.push({ name: `${item.people.full_name}, ${item.accounts.name}`, error });
            // The daily limit applies to every remaining send too: stop rather than fail each one.
            if (/daily (sender )?cap|daily sending limit|cap of \d+ reached/i.test(error)) { progress.current = ""; setBulkProgress({ ...progress }); setNotice(`Stopped: ${error} ${progress.sent} sent today from this run; the rest stay ready for tomorrow.`); return; }
          }
        } catch {
          progress.failed.push({ name: `${item.people.full_name}, ${item.accounts.name}`, error: "Connection interrupted; check Gmail Sent before retrying this one." });
        }
        setBulkProgress({ ...progress });
        if (index < verified.length - 1 && !bulkStop.current) await new Promise(resolve => setTimeout(resolve, 8000 + Math.floor(Math.random() * 4000)));
      }
      progress.current = "";
      setBulkProgress({ ...progress });
      setNotice(`${bulkStop.current ? "Stopped. " : ""}Sent ${progress.sent} of ${progress.total}.${progress.failed.length ? ` ${progress.failed.length} not sent: ${progress.failed.map(f => `${f.name} (${f.error})`).join("; ")}` : ""}${others ? ` ${others} draft${others === 1 ? " with no usable address was" : "s with no usable address were"} skipped.` : ""}`);
    } finally { sendInFlight.current = false; setBulkSending(false); }
  }
  // "Propose times": pull open slots from the connected calendar and drop them into the email draft to edit.
  // Strictly opt-in — nothing adds times on its own — and reversible, because it writes into the saved draft.
  const [proposing, setProposing] = useState(false);
  const beforeTimes = useRef(new Map<string, string>());
  const timesInDraft = hasProposedTimes(focusCard?.email_body) || (focusCard?.email_body ?? "").includes("Available times:\n");
  // Take the times back out: off the draft AND off the card, so a reply can no longer auto-book against
  // times the operator has withdrawn.
  const removeMeetingTimes = async () => {
    if (!focusCard) return;
    const body = beforeTimes.current.get(focusCard.id) ?? stripProposedTimes(focusCard.email_body).replace(/\n*Available times:[\s\S]*$/, "\n\nWould a short call be useful?");
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
      beforeTimes.current.set(focusCard.id, focusCard.email_body ?? "");
      const body = meetingTimesBody(focusCard.email_body ?? "", (json.slots as Array<{label:string}>).map(slot => slot.label));
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
    const recommended = availableVersions.find(v => v.id === recommendation?.recommended?.id);
    if (recommended) { previewTone(recommended); return; }
    const id = focusCard.id;
    setLoadingReviewed(true);
    try {
      const response = await fetch(`/api/cards/${id}/reviewed-draft`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) { setNotice(result.error ?? "Could not load the reviewed draft."); return; }
      setCards(current => current.map(item => item.id === id && preservesCurrentDraft(item, focusCard) ? { ...item, email_subject: result.email_subject, email_body: result.email_body, status: result.status, assigned_to: result.assigned_to } : item));
      if (result.updated_at) serverVersions.current.set(id, result.updated_at);
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
    const linkedInPair = {};
    void patchFocus({ ...linkedInPair, [key]: value, ...promote });
  };
  // Shared "someone is on this" flag so the two people on the desk don't message the same prospect. Best-effort.
  function markWorking(on: boolean) {
    if (!focusCard) return;
    const id = focusCard.id;
    setCards((current) => current.map((item) => item.id === id ? { ...item, working_at: on ? new Date().toISOString() : null } : item));
    const previous = saveQueues.current.get(id) ?? Promise.resolve(true);
    const task = previous.then(async () => {
      try {
        const response = await fetch(`/api/cards/${id}/claim`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ on, expected_updated_at: serverVersions.current.get(id) }) });
        const json = await response.json();
        if (response.ok && json.updated_at) serverVersions.current.set(id, json.updated_at);
        return response.ok;
      } catch { return false; }
    });
    saveQueues.current.set(id, task);
    void task.finally(() => { if (saveQueues.current.get(id) === task) saveQueues.current.delete(id); });
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

            {notice && <div className="notice" role="alert"><span>{notice}</span><button type="button" className="btn" aria-label="Dismiss notification" onClick={()=>setNotice("")}>×</button></div>}

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
          <header className="deskwork-head deskwork-head-compact">
            <div className="workspace-progress"><h1>Reach-out list</h1>{batchSequence && progress && <span>{batchSequence === 1 ? `${progress.completed} of ${progress.total} completed` : batchSequence === 3 ? `Today's list · ${cards.length} companies` : 'Next 25'}</span>}</div>
            <div className="deskwork-head-actions">{tools}<a className="deskwork-overview" href={overviewHref}>Overview &rarr;</a></div>
          </header>
          {autoSendBar}

          <div className="deskwork-grid">
            {/* LEFT — companies */}
            <aside className="deskwork-list">
              <div className="deskwork-list-head"><span>{listNeedle ? <>Matches <b>{listed.length}</b></> : <>Companies <b>{new Set(focusPool.map(item => item.accounts.domain)).size}</b></>}</span></div>
              <label className="reachout-sort-label">Sort by<select aria-label="Sort companies" className="reachout-sort" value={listSort} onChange={event => changeSort(event.target.value as ReachoutSort)}>{batchSequence === 3 && <option value="list-order">List order (send order)</option>}<option value="revenue-desc">Revenue: highest first</option><option value="revenue-asc">Revenue: lowest first</option><option value="name">Company: A to Z</option><option value="verified">Verified email first</option></select></label>
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
                      <small>{revenueLabel(item.accounts.domain) ? `${revenueLabel(item.accounts.domain)} revenue · ${revenueYearLabel(item.accounts.domain)}` : signalLabel(item)}{item.working ? " · working" : ""}</small>
                      {(fitScore(item.accounts.domain) !== null || (batchSequence === 3 && autoSend)) && <small style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                        {fitScore(item.accounts.domain) !== null && <em className="chip chip-fit">Fit {fitScore(item.accounts.domain)}</em>}
                        {batchSequence === 3 && autoSend && (() => {
                          const state = sendStateLabel(item, focusedAccount(item.accounts.domain), autoSend.blocker, autoSend.sentAt[item.id] ?? null, autoSend);
                          return <em className="chip carried" title={state.kind === "auto" || state.kind === "manual" ? "A prediction: the real checks run at send time." : undefined}>{state.label}</em>;
                        })()}
                      </small>}
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
                  <div className="deskwork-co-name"><h2>{focusCard.accounts.name}{focusCard.isNew ? <em className="new-label">New</em> : focusCard.carriedOver ? <em className="chip carried">{carriedLabel(focusCard.created_at)}</em> : null}</h2><p>{research ? `Market signal · ${dateLabel(research?.trigger.date) ? `Published ${dateLabel(research?.trigger.date)}` : "date not confirmed"}` : `${signalLabel(focusCard)}${signalWhen(focusCard) ? ` · ${signalWhen(focusCard)}` : ""}`}</p></div>
                  <Link href={listHref} className="focus-link">All {curatedDomains().length} companies</Link>
                </header>

                <div className="deskwork-opening">
                  {focusedAccount(focusCard.accounts.domain) && <div className="reachout-account-facts"><a href={focusedAccount(focusCard.accounts.domain)!.revenue.sourceUrl} target="_blank" rel="noreferrer"><strong>{revenueLabel(focusCard.accounts.domain)}</strong><span>{revenueYearLabel(focusCard.accounts.domain)} reported revenue ↗</span></a><span>{focusedAccount(focusCard.accounts.domain)!.sector}</span></div>}
                  {(() => {
                    // Nightly companies carry the scored evidence that put them on the list.
                    const fit = (focusedAccount(focusCard.accounts.domain) as { aiFit?: AiFit } | undefined)?.aiFit;
                    return fit && !fit.disqualified ? <div className="reachout-ai-fit"><b>AI fit {fit.score}/100</b><ul>{fit.reasons.slice(0, 4).map((reason, index) => <li key={`${reason.criterion}-${index}`}>{reason.url ? <a href={reason.url} target="_blank" rel="noreferrer">{reason.text} ↗</a> : reason.text}</li>)}</ul></div> : null;
                  })()}
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
              <section className="deskwork-draft composer-v2">
                <div className="deskwork-draft-top"><span className="overview-kick">{sentAlready ? "Sent email" : "Outreach draft"}</span><span className="deskwork-draft-topright">{focusCard.invite_link ? <a className="deskwork-booked" href={focusCard.invite_link.startsWith("http") ? focusCard.invite_link : undefined} target="_blank" rel="noreferrer">📅 Meeting booked</a> : null}<a className="deskwork-brief-link" href={`/brief/${focusCard.id}`} target="_blank" rel="noreferrer">Call brief ↗</a></span></div>
                {!sentAlready && channelTab === "email" && !recommendation && <div className="notice" style={{ margin: "12px 16px" }}>
                  {research ? <>
                    <strong>{research.disposition === "hold" ? "Hold: buyer fit needs review." : "Written for this contact."}</strong>{" "}
                    {(matchesResearch || selectedVersion) ? "Review and make it yours before sending." : "Your saved edits are preserved."}
                    {!matchesResearch && !selectedVersion && <button type="button" disabled={loadingReviewed || !!altContact} onClick={loadReviewedDraft}>{loadingReviewed ? "Loading…" : research.disposition === "hold" ? "Load optional partnership draft" : "Use researched draft"}</button>}
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
                  <button type="button" className={`deskwork-tab ${channelTab === "email" ? "is-active" : ""}`} onClick={() => { setChannelTab("email"); setTonePreview(null); }}>✉ Email</button>
                  <button type="button" className={`deskwork-tab ${channelTab === "linkedin" ? "is-active" : ""}`} onClick={() => { setCards(current => current.map(item => item.id === focusCard.id ? withDefaultLinkedIn(item, senderName) : item)); setChannelTab("linkedin"); setTonePreview(null); }}><i className="li-mark">in</i> LinkedIn</button>

                </div>

                {(channelTab === "linkedin" || !sentAlready) && !altContact && savedVariants(focusCard.accounts.domain, contact.full_name, channelTab).length > 0 && <section className="email-versions" aria-label={`Saved ${channelTab === "email" ? "email" : "LinkedIn"} versions`}>
                  <div className="email-versions-heading"><span>{channelTab === "email" ? "Email" : "LinkedIn"} versions</span><Link href={channelTab === "linkedin" ? "/stats?source=manual#saved-versions" : "/stats#saved-versions"}>Analytics ↗</Link></div>
                  <div className="email-version-tabs" role="group" aria-label={`Choose ${channelTab === "email" ? "an email" : "a LinkedIn"} version`}>
                    {recommendation?.candidates.map(candidate => {
                      const variant = availableVersions.find(v => v.id === candidate.id);
                      const active = previewingVersion ? tonePreview?.versionId === candidate.id : selectedVersion?.id === candidate.id;
                      return <button type="button" key={candidate.id} className={active ? "is-active" : ""} disabled={busy || !variant} title={candidate.reason} aria-pressed={active} onClick={() => { if(variant) { if(selectedVersion?.id === variant.id) setTonePreview(null); else previewTone(variant); } }}><strong>{candidate.label}</strong><small>{candidate.id === "direct-offer" ? "Start a conversation" : candidate.id === "concrete-idea" ? "Offer a specific starting point" : "Show how we deliver"}</small>{recommendation.recommended?.id === candidate.id && <span className="composer-recommended">Recommended</span>}</button>;
                    })}
                  </div>
                  <details className="draft-details"><summary>{recommendation?.recommended ? `About ${recommendation.recommended.label}` : "Draft details"} · research &amp; checks</summary>
                    {recommendation?.recommended && <p><strong>Recommended: {recommendation.recommended.label}.</strong> {recommendation.recommended.reason}</p>}
                    {recommendation?.candidates.filter(c=>!c.eligible).map(c=><p key={c.id}><strong>{c.label}:</strong> {c.reason}</p>)}
                    {recommendation?.giftId && <a className="gift-preview-link" href={`/gift/${recommendation.giftId}`} target="_blank" rel="noreferrer">View the completed Gift ↗</a>}
                    {channelTab === "email" && !sentAlready && <FirstTouchGuidance key={contact.id} title={contact.title ?? ""} subject={focusCard.email_subject ?? ""} body={focusCard.email_body ?? ""} />}
                  </details>
                </section>}

                <div className="composer-toolbar">
                  <div className="composer-mode" role="group" aria-label="Message view">
                    <button type="button" aria-pressed={!previewingVersion && editing[channelTab]} disabled={sentAlready && channelTab === "email"} onClick={() => { if(previewingVersion) { void applyTone(); } setEditing(state => ({...state,[channelTab]:true})); }}>Edit{previewingVersion ? " this version" : ""}</button>
                    <button type="button" aria-pressed={previewingVersion || !editing[channelTab]} onClick={() => setEditing(state => ({...state,[channelTab]:false}))}>Preview</button>
                  </div>
                  <span className="composer-sender">From <strong>{senderName}</strong></span>
                  <details className="composer-menu"><summary>More ···</summary><div>
                    <button type="button" disabled={busy} onClick={() => copyAndLog(channelTab)}>Copy saved message</button>
                    {channelTab === "email" && <button type="button" disabled={applyingSubject} onClick={applySubjectToAll}>Apply subject to all unsent drafts</button>}
                    {channelTab === "email" && <button type="button" disabled={proposing} onClick={timesInDraft ? removeMeetingTimes : proposeMeetingTimes}>{timesInDraft ? "Remove meeting times" : "Add meeting times"}</button>}
                    {!sentAlready && <button type="button" disabled={loadingReviewed || !!altContact} onClick={loadReviewedDraft}>Restore recommended draft</button>}
                    <button type="button" disabled={busy} onClick={() => markSent(channelTab)}>Mark as already sent</button>
                    {channelTab === "email" && <button type="button" disabled={!senderIsViewer || enrolling} onClick={startSequence}>Start automated sequence</button>}
                    <button type="button" disabled={busy} onClick={snoozeCurrent}>Snooze contact</button>
                    <button type="button" disabled={busy} onClick={dismissCurrent}>Dismiss contact</button>
                  </div></details>
                </div>
                {conflict?.id===focusCard.id&&<div className="composer-alert" role="status"><strong>Your changes have not been saved.</strong> Your text is still here. <button className="btn" type="button" onClick={()=>reviewConflict(focusCard.id)}>Review saved draft</button>{conflict.saved&&<><p>Saved subject: {channelTab==='email'?conflict.saved.email_subject:conflict.saved.linkedin_subject}</p><pre style={{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}}>{channelTab==='email'?conflict.saved.email_body:conflict.saved.linkedin_message}</pre><button type="button" className="btn" disabled={sending} onClick={async()=>{const saved=conflict.saved!;serverVersions.current.set(focusCard.id,saved.updated_at);const values=channelTab==='email'?{email_subject:focusCard.email_subject??'',email_body:focusCard.email_body??''}:{linkedin_subject:focusCard.linkedin_subject??'',linkedin_message:focusCard.linkedin_message??''};await patchFocus(values);}}>Save my edits over this copy</button><button type="button" className="btn" onClick={()=>setConflict({id:focusCard.id})}>Close comparison</button></>}</div>}
                {channelTab === "email" && !senderFooterHtml && <p className="composer-alert">No signature is available for {senderName}. <Link href="/settings">Check signature settings</Link>.</p>}
                {senderConflict && <p className="composer-alert" role="alert">{senderConflict}</p>}
                <div className="deskwork-scroll">
                {previewingVersion && tonePreview ? (
                  <article className="email-version-document" aria-label={`${tonePreview.label} ${channelTab} preview`}>
                    <div className="email-version-caption"><span>{tonePreview.label} · Preview</span><span>{outreachBody(tonePreview.body).split(/\s+/).filter(Boolean).length} words</span></div>
                    <div className="email-version-recipient"><span>To</span>{contact.full_name}{channelTab === "email" && contact.email ? ` · ${contact.email}` : ""}</div>
                    {channelTab === "email" && <h3>{tonePreview.subject}</h3>}
                    <div className="email-version-body">{outreachBody(tonePreview.body)}</div>
                    {channelTab === "email" && <p className="email-version-signature">{senderName.trim().split(/\s+/)[0]}</p>}
                    {channelTab === "email" && senderFooterHtml && (sentAlready ? <div className="outreach-saved-footer" dangerouslySetInnerHTML={{ __html: senderFooterHtml }} /> : <div className="outreach-saved-footer" dangerouslySetInnerHTML={{__html:firstTouchFooterHtml(senderFooterHtml)}} />)}
                  </article>
                ) : channelTab === "email" ? (
                  editing.email && !sentAlready ? (() => {
                    return (
                      <div className="deskwork-edit deskwork-compose">
                        {whyText && <p className="composer-why"><b>Why this company:</b> {whyText}</p>}
                        <div className="compose-to"><span>To</span><b>{contact.email ?? `${contact.full_name} · no address on file`}</b>{contact.email && <em className={`address-badge ${addressConfirmed(contact) ? "is-confirmed" : "is-unconfirmed"}`} title={addressConfirmed(contact) ? "Confirmed: included in Send all ready and auto-send" : "Unconfirmed: send this one by hand"}>{addressConfirmed(contact) ? "Confirmed" : "Unconfirmed"}</em>}</div>
                        <div className={`reachout-address-status ${contact.email_status === "verified" ? "verified" : ""}`}>
                          {contact.email_status === "verified" ? "Verified email" : contact.email ? ((focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.email === contact.email && focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.emailStatus === "inferred") ? "Address inferred · unverified" : "Saved address · unverified") : "Email not found. This draft is ready to edit; add a confirmed address before sending."}
                          {contact.email && focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.email === contact.email && focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.emailSourceUrl && <a href={focusedContact(focusCard.accounts.domain ?? "", contact.full_name)!.emailSourceUrl!} target="_blank" rel="noreferrer">{focusedContact(focusCard.accounts.domain ?? "", contact.full_name)?.emailStatus === "inferred" ? "Research source ↗" : "Address source ↗"}</a>}
                        </div>
                        <div className="focus-subject-row">
                          <label className="composer-subject-field"><span>Subject</span><input
                            disabled={sending}
                            aria-label="Email subject"
                            className="focus-msg-subject"
                            value={emailStyle(focusCard.email_subject ?? "")}
                            placeholder={subjectFallback || "Subject line (optimized for a reply)"}
                            // The value as it stood before this edit is the restore point, so backspacing it
                            // away character by character brings back the whole line, not the last letter.
                            onFocus={(event) => rememberSubject(focusCard.id, event.target.value)}
                            onChange={(event) => editFocus("email_subject", emailStyle(event.target.value))}
                            // Leaving the field empty saves the subject back rather than saving a blank one.
                            // Event-only callback; no ref is read during rendering.
                            // eslint-disable-next-line react-hooks/refs
                            maxLength={120} onBlur={(event) => { if (event.target.value.trim()) saveField("email_subject", event.target.value); else restoreSubject(true); }}
                          />
                          </label>
                          
                          {subjectIsBlank && subjectFallback && <button type="button" className="focus-apply-all" onClick={() => restoreSubject(false)}>Restore subject</button>}
                        </div>
                        <details className="composer-bulk-opening"><summary>Set an opening for all emails</summary>
                          <label htmlFor="bulk-opening">Opening paragraph</label>
                          <textarea id="bulk-opening" rows={3} maxLength={400} value={bulkOpening} onChange={event=>setBulkOpening(event.target.value)} placeholder="Write the opening you want each email to start with…" />
                          <div><small>Replaces the first paragraph after the greeting in this list’s unsent drafts. Keeps each greeting and the rest of the message.</small><button type="button" className="btn" disabled={applyingOpening || applyingSubject || !bulkOpening.trim()} onClick={()=>applyCopyToAll("opening")}>{applyingOpening ? "Applying…" : "Apply opening to this batch"}</button></div>
                        </details>
                        <div role="status" aria-live="polite"><small>Subject {focusCard.email_subject?.length ?? 0}/120 · </small>{bulkUndo.length > 0 && <button type="button" className="btn" onClick={undoBulk}>Undo last batch edit</button>}{saveState}{saveState !== "Saved" && <button type="button" className="btn" onClick={() => { void patchFocus({ email_subject: focusCard.email_subject ?? "", email_body: focusCard.email_body ?? "" }); }}>Save changes</button>}</div>
                        {!altContact && <div className="composer-batch" role="group" aria-label="Batch actions">
                          <span className="composer-batch-label">Whole list</span>
                          <button type="button" className="btn" disabled={bulkSending || applyingSubject || applyingOpening || applyingMessage || !focusCard.email_subject?.trim()} onClick={applySubjectToAll} title="Use this subject on the other unsent emails; each company's name is swapped in">{applyingSubject ? "Applying…" : "Apply subject to batch"}</button>
                          <button type="button" className="btn" disabled={bulkSending || applyingSubject || applyingOpening || applyingMessage || !focusCard.email_body?.trim()} onClick={applyMessageToAll} title="Use this message on the other unsent emails; each company's name and each greeting's first name are swapped in">{applyingMessage ? "Applying…" : "Apply message to batch"}</button>
                          {bulkUndo.length > 0 && <button type="button" className="btn ghost" disabled={bulkSending} onClick={undoBulk}>Undo last batch edit</button>}
                          {senderIsViewer && (() => { const ready = readyToSend(batchOwner(focusCard.accounts.domain ?? "")); const verified = ready.filter(c => sendableAddress(c.people as unknown as Parameters<typeof sendableAddress>[0])).length; return <><button type="button" className="btn primary" disabled={bulkSending || sending || !verified} onClick={() => void sendAllReady()} title="Send every unsent draft with an address, confirmed or not, one at a time">{bulkSending ? "Sending…" : `Send all ready (${verified})`}</button></>; })()}
                        </div>}
                        {bulkProgress && <div className="composer-batch-progress" role="status" aria-live="polite">
                          <progress max={bulkProgress.total} value={bulkProgress.sent + bulkProgress.failed.length} />
                          <span>{bulkSending ? `Sending ${Math.min(bulkProgress.sent + bulkProgress.failed.length + 1, bulkProgress.total)} of ${bulkProgress.total}${bulkProgress.current ? `: ${bulkProgress.current}` : ""}` : `Done: ${bulkProgress.sent} sent${bulkProgress.failed.length ? `, ${bulkProgress.failed.length} not sent` : ""}`}</span>
                          {bulkSending ? <button type="button" className="btn" onClick={() => { bulkStop.current = true; }}>Stop</button> : <button type="button" className="btn ghost" onClick={() => setBulkProgress(null)}>Dismiss</button>}
                        </div>}<label className="compose-field"><span>Message · {focusCard.email_body?.length ?? 0}/1000</span><textarea disabled={sending} maxLength={1000} className="focus-msg-body" rows={14} value={emailStyle(brief ? outreachBody(adapt(focusCard.email_body ?? "")) : adapt(focusCard.email_body ?? ""))} readOnly={!!altContact} onChange={(event) => editFocus("email_body", emailStyle(event.target.value))} onBlur={(event) => { if (!altContact) saveField("email_body", event.target.value); }} /></label>
                        <p className="compose-sig">{brief ? senderName.trim().split(/\s+/)[0] : senderName}</p>
                    {channelTab === "email" && senderFooterHtml && (sentAlready ? <div className="outreach-saved-footer" dangerouslySetInnerHTML={{ __html: senderFooterHtml }} /> : <div className="outreach-saved-footer" dangerouslySetInnerHTML={{__html:firstTouchFooterHtml(senderFooterHtml)}} />)}
                      </div>
                    );
                  })() : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head">
                        {whyText && <p className="composer-why"><b>Why this company:</b> {whyText}</p>}
                        <div className="mail-row"><span>To</span><b>{contact.email ?? `${contact.full_name} · no address on file`}</b>{contact.email && <em className={`address-badge ${addressConfirmed(contact) ? "is-confirmed" : "is-unconfirmed"}`} title={addressConfirmed(contact) ? "Confirmed: included in Send all ready and auto-send" : "Unconfirmed: send this one by hand"}>{addressConfirmed(contact) ? "Confirmed" : "Unconfirmed"}</em>}</div>
                        <div className="mail-row"><span>Subject · {focusCard.email_subject?.length ?? 0}/120</span><b>{subjectView("email", focusCard.email_subject || subjectGuess(focusCard, "email"))}</b></div>
                      </div>
                      {sentAlready && <div className="deskwork-sent-note">This email has been sent{focusCard.people.full_name ? ` to ${contact.full_name}` : ""}. It is kept here as a record &mdash; the follow-ups below are what happens next.</div>}
                      {diffFor("email") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("email", emailStyle(brief ? outreachBody(adapt(emailDraft)) : adapt(emailDraft)) || "No email draft yet. Choose a saved version or write your own.")}</div>
                      <div className="deskwork-doc-sig">{brief ? senderName.trim().split(/\s+/)[0] : senderName}</div>
                    {channelTab === "email" && senderFooterHtml && (sentAlready ? <div className="outreach-saved-footer" dangerouslySetInnerHTML={{ __html: senderFooterHtml }} /> : <div className="outreach-saved-footer" dangerouslySetInnerHTML={{__html:firstTouchFooterHtml(senderFooterHtml)}} />)}
                    </div>
                  )
                ) : (
                  editing.linkedin ? (
                    <div className="deskwork-edit">
                      <div role="status" aria-live="polite">{saveState} · Message {focusCard.linkedin_message?.length ?? 0}/1500 · Subject {focusCard.linkedin_subject?.length ?? 0}/120{saveState !== "Saved" && <button type="button" className="btn" onClick={() => { void patchFocus({linkedin_subject: focusCard.linkedin_subject ?? "", linkedin_message: focusCard.linkedin_message ?? ""}); }}>Save changes</button>}</div><input disabled={sending} maxLength={120} className="focus-msg-subject" value={focusCard.linkedin_subject ?? ""} placeholder="Subject (used for InMail)" onChange={(event) => editFocus("linkedin_subject", event.target.value)} onBlur={(event) => saveField("linkedin_subject", event.target.value)} />
                      <textarea disabled={sending} maxLength={1500} className="focus-msg-body" value={focusCard.linkedin_message ?? focusCard.linkedin_note ?? focusCard.linkedin_comment ?? ""} rows={11} placeholder="No LinkedIn message yet. Write your message here." onChange={(event) => editFocus("linkedin_message", event.target.value)} onBlur={(event) => saveField("linkedin_message", event.target.value)} />
                    </div>
                  ) : (
                    <div className="deskwork-doc">
                      <div className="deskwork-doc-head"><div className="mail-row"><span>Subject · {focusCard.email_subject?.length ?? 0}/120</span><b>{subjectView("linkedin", focusCard.linkedin_subject || subjectGuess(focusCard, "linkedin"))}</b></div></div>
                      {diffFor("linkedin") && <div className="diff-bar"><span>AI changes — <em className="diff-del">removed</em> · <em className="diff-add">added</em></span><button type="button" onClick={() => setLastRefine(null)}>Clear</button></div>}
                      <div className="deskwork-doc-body">{bodyView("linkedin", adapt(linkedinDraft) || "No LinkedIn message yet. Write your message here.")}</div>
                    </div>
                  )
                )}

                {!previewingVersion && (() => {
                  const seq = (focusCard.followups ?? []).filter((f) => (channelTab === "email" ? f.channel === "email" : f.channel !== "email"));
                  if (seq.length === 0) {
                    if (channelTab === "linkedin") return <div className="deskwork-fu-hint">Open LinkedIn to copy and send this message. Use <b>Mark sent</b> afterward to record its version in History and Analytics.</div>;
                    return <details className="composer-followup-note"><summary>After sending</summary><p>Your follow-ups appear here after sending. To start an automated sequence, open More.</p></details>;
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
                          {step.status === "pending" && step.channel === "email" && <button type="button" className="deskwork-fu-copy" disabled={!!sendingStep || !senderIsViewer} title="Send this one now instead of waiting for its scheduled day" onClick={() => sendFollowupNow(step.id, step.title)}>{sendingStep === step.id ? "Sending…" : "Send now"}</button>}
                        </div>
                      </div>
                    ))}
                  </div>;
                })()}
                </div>



                <footer className="composer-actions">
                  <div className="composer-action-context"><strong>{previewingVersion && tonePreview ? `${tonePreview.label} preview` : sentAlready ? "Sent message" : "Ready for a final check"}</strong><small>{!senderIsViewer ? `Prospect sends use ${senderName}’s account. You can test in your inbox.` : previewingVersion ? "Testing uses the version shown above." : "Tests go only to your own inbox."}</small></div>
                  <div className="composer-action-buttons">
                    {channelTab === "email" && !altContact && !sentAlready && <TestEmailButton key={`${focusCard.id}:${tonePreview?.versionId ?? "draft"}:${tonePreview?.body ?? focusCard.email_body}:${tonePreview?.subject ?? focusCard.email_subject}`} cardId={focusCard.id} subject={previewingVersion && tonePreview ? tonePreview.subject : focusCard.email_subject ?? ""} body={previewingVersion && tonePreview ? tonePreview.body : focusCard.email_body ?? ""} disabled={demo || busy || sending} />}
                    {batchSequence === 3 && channelTab === "email" && !altContact && !sentAlready && !previewingVersion && <label className="btn" title="The morning auto-send skips this company; you can still send it yourself." style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" checked={Boolean(focusCard.auto_send_hold)} disabled={demo || holdBusy || !senderIsViewer} onChange={event => void toggleHold(focusCard.id, event.target.checked)} />
                      {focusCard.auto_send_hold ? "Kept for you" : "Keep for me (don't auto-send)"}
                    </label>}
                    {previewingVersion && tonePreview ? <><button type="button" className="btn" onClick={() => setTonePreview(null)}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={applyTone}>{busy ? "Saving…" : "Use this version"}</button></> : channelTab === "email" ? !sentAlready && <button type="button" disabled={!senderIsViewer || sending || !contact.email} className="btn primary" title={!senderIsViewer ? `Sign in as ${senderName} to send to this contact` : `Send to ${contact.full_name}`} onClick={sendEmail}>{sending ? "Sending…" : "Send email"} →</button> : <button type="button" className="btn primary" onClick={openLinkedIn}>Open LinkedIn ↗</button>}
                  </div>
                </footer>
                {notice && <div className="notice focus-notice" role="alert" style={{display:"flex",alignItems:"flex-start",gap:12}}><span style={{flex:1}}>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={()=>setNotice("")} style={{border:0,background:"transparent",fontSize:24,lineHeight:1,cursor:"pointer",padding:4}}>×</button></div>}
              </section>
            </>) : (
              <div className="deskwork-clear">
                <h2>All caught up</h2>
                <p>Every prospect has been actioned. New ones land here after the next scan.</p>
                <a className="btn" href={overviewHref}>Overview</a>
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
