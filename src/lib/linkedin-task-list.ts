/** One manual LinkedIn send waiting on a person: a first message on a LinkedIn-first card, or a follow-up that came due. */
export type LinkedInTask = {
  /** "card:<id>" or "step:<id>", unique across both kinds. */
  key: string;
  kind: "first" | "followup";
  cardId: string;
  /** The follow-up step, for marking it sent; null on a first message. */
  stepId: string | null;
  step: number | null;
  personId: string | null;
  name: string; title: string; company: string; domain: string;
  profileUrl: string | null;
  subject: string | null;
  message: string;
  /** When it became due: the step's scheduled time, or the draft's last change. */
  dueAt: string;
};

/** A LinkedIn send already recorded, for Done recently. */
export type LinkedInDone = { id: string; name: string; company: string; message: string; sentAt: string; channel: string };

export type FirstMessageRow = {
  id: string; person_id: string; updated_at: string; channel: string; status: string;
  linkedin_subject: string | null; linkedin_message: string | null;
  people: { full_name: string | null; title: string | null; linkedin_url: string | null; do_not_contact: boolean | null } | null;
  accounts: { name: string | null; domain: string | null } | null;
};

export type FollowupStepRow = {
  id: string; step_number: number; channel: string; status: string; scheduled_at: string; sent_at: string | null; error: string | null;
  subject: string | null; body: string | null;
  cadences: {
    card_id: string; person_id: string; owner: string; status: string;
    people: { full_name: string | null; title: string | null; linkedin_url: string | null; do_not_contact: boolean | null } | null;
    cards: { accounts: { name: string | null; domain: string | null } | null } | null;
  } | null;
};

export const LINKEDIN_FIRST = ["linkedin_first", "linkedin_only"];
export const OPEN_DRAFT = ["new", "edited", "approved"];
export const LINKEDIN_TOUCHES = ["linkedin_message", "linkedin_request", "linkedin_comment"];

const profile = (url: string | null | undefined) => {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
};

/**
 * Pure: the seat's open LinkedIn sends. Follow-ups that came due come first, oldest first; then first messages on
 * LinkedIn-first cards that have no LinkedIn touch yet, oldest draft first. Opted-out people are left out, and a card
 * with a follow-up already has its first message out, so it never shows twice.
 */
export function buildLinkedInTasks(cards: FirstMessageRow[], touchedCardIds: Set<string>, steps: FollowupStepRow[], now: number): LinkedInTask[] {
  const followups: LinkedInTask[] = steps
    .filter((row) => row.cadences && row.cadences.status === "active" && LINKEDIN_TOUCHES.includes(row.channel) && ["pending", "ready", "failed"].includes(row.status)
      && (!row.sent_at || row.error === "Manual activity pending") && Date.parse(row.scheduled_at) <= now && !row.cadences.people?.do_not_contact && Boolean(row.body?.trim()))
    .map((row) => {
      const cadence = row.cadences!;
      return {
        key: `step:${row.id}`, kind: "followup" as const, cardId: cadence.card_id, stepId: row.id, step: row.step_number, personId: cadence.person_id,
        name: cadence.people?.full_name ?? "Unknown contact", title: cadence.people?.title ?? "", company: cadence.cards?.accounts?.name ?? "", domain: cadence.cards?.accounts?.domain ?? "",
        profileUrl: profile(cadence.people?.linkedin_url), subject: row.subject, message: row.body!.trim(), dueAt: row.scheduled_at,
      };
    })
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const withFollowup = new Set(followups.map((task) => task.cardId));
  const firsts: LinkedInTask[] = cards
    .filter((row) => LINKEDIN_FIRST.includes(row.channel) && OPEN_DRAFT.includes(row.status) && Boolean(row.linkedin_message?.trim()) && row.people && !row.people.do_not_contact
      && !touchedCardIds.has(row.id) && !withFollowup.has(row.id))
    .map((row) => ({
      key: `card:${row.id}`, kind: "first" as const, cardId: row.id, stepId: null, step: null, personId: row.person_id,
      name: row.people?.full_name ?? "Unknown contact", title: row.people?.title ?? "", company: row.accounts?.name ?? "", domain: row.accounts?.domain ?? "",
      profileUrl: profile(row.people?.linkedin_url), subject: row.linkedin_subject?.trim() || null, message: row.linkedin_message!.trim(), dueAt: row.updated_at,
    }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return [...followups, ...firsts];
}
