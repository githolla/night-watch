import type { TargetTier } from "./target-accounts.ts";

/**
 * Where a reach-out company stands, kept by hand on the Reach-out page.
 * Night Watch fills the evidence; the two people working the list move
 * the stage. Closed stages drop out of the working views.
 */
export const OUTREACH_STAGES = [
  ["untouched", "Untouched"],
  ["researching", "Researching"],
  ["ready", "Ready to contact"],
  ["contacted", "Contacted"],
  ["replied", "Replied"],
  ["meeting", "Meeting set"],
  ["won", "Won"],
  ["lost", "Closed, no fit"],
  ["hold", "On hold"],
] as const;

export type OutreachStage = (typeof OUTREACH_STAGES)[number][0];
export const STAGE_LABEL: Record<OutreachStage, string> = Object.fromEntries(OUTREACH_STAGES) as Record<OutreachStage, string>;
export const STAGE_ORDER: OutreachStage[] = OUTREACH_STAGES.map(([value]) => value);
export const CLOSED_STAGES: ReadonlySet<OutreachStage> = new Set(["won", "lost", "hold"]);

export function isOutreachStage(value: unknown): value is OutreachStage {
  return typeof value === "string" && (STAGE_ORDER as string[]).includes(value);
}

/** One line on the Reach-out board: the file's facts plus everything Night Watch has found. */
export type OutreachRow = {
  id: string | null;
  domain: string;
  name: string;
  tier: TargetTier | string;
  synced: boolean;
  industry: string;
  subSegment: string;
  hqCity: string;
  hqState: string;
  ownership: string;
  peSponsor: string;
  revenueBand: string;
  revenueEstimateUsdM: number | null;
  employees: number | null;
  ceo: string;
  targetTitles: string[];
  aiSignal: string;
  notes: string;
  sourceUrl: string;
  intelScore: number;
  openRoles: number;
  aiPosts: number;
  contacts: number;
  verifiedEmails: number;
  lastChangeAt: string | null;
  lastResearchedAt: string | null;
  careersStatus: string | null;
  openDossiers: number;
  topDossierScore: number;
  sent: number;
  replied: number;
  meetings: number;
  stage: OutreachStage;
  owner: string;
  ownerNotes: string;
  stageUpdatedAt: string | null;
  /** True when someone put the company on the list by hand, or kept it there against the cut. */
  manual: boolean;
  /** Why to contact them now, in one line, from what is on file. */
  why: string;
  /** The reasons behind the line, one each. */
  reasons: string[];
  /** Who to write to first, and how reachable they are. */
  who: string;
  whoTitle: string;
  whoReach: "verified" | "email" | "linkedin" | "none";
  /** The best open draft, if one is written. */
  draftCardId: string | null;
  draftScore: number;
  draftWhy: string;
  /** Contact-first ranking; higher first. */
  rank: number;
};
