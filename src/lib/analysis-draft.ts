import { classifyTitle, type JobFamily } from "./job-sweep/classify.ts";
import { recency } from "./scoring.ts";

/**
 * The rules, free of any database, that turn an analysis into a draft: who
 * to write to, how the draft is scored, and which of the roles the hiring
 * agent read belong in the job postings table. Tested directly.
 */

/** A draft is written from the analysis only when the synthesizer rates the fit at least this. */
export const DRAFT_FIT_FLOOR = 40;

export type DraftCandidate = {
  id: string;
  full_name: string;
  title: string;
  level: string;
  email: string | null;
  email_status: string;
  linkedin_url: string | null;
  path_score: number | null;
};

function key(name: string) {
  return name.toLowerCase().replace(/[^a-z]/g, "");
}
function lastName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase().replace(/[^a-z]/g, "") : "";
}

/**
 * The person the synthesizer named, matched to the people table by full
 * name, then by last name plus first initial. When nobody matches, the
 * most senior reachable person, favouring anyone who has posted.
 */
export function pickWhoFirst(whoFirst: string, people: DraftCandidate[], postedBy: string[] = []): { person: DraftCandidate | null; how: "named" | "ranked" | "none" } {
  const wanted = key(whoFirst);
  if (wanted) {
    const exact = people.find((person) => key(person.full_name) === wanted);
    if (exact) return { person: exact, how: "named" };
    const last = lastName(whoFirst);
    const initial = whoFirst.trim()[0]?.toLowerCase();
    const loose = last ? people.find((person) => lastName(person.full_name) === last && person.full_name.trim()[0]?.toLowerCase() === initial) : null;
    if (loose) return { person: loose, how: "named" };
  }
  const posted = new Set(postedBy.map(key));
  const levelRank: Record<string, number> = { owner: 3, influencer: 2, adjacent: 1, unknown: 0 };
  const ranked = [...people].sort((a, b) => scoreOf(b) - scoreOf(a));
  function scoreOf(person: DraftCandidate) {
    return (levelRank[person.level] ?? 0) * 3
      + (posted.has(key(person.full_name)) ? 4 : 0)
      + (person.email_status === "verified" ? 3 : person.email ? 1 : 0)
      + (person.linkedin_url ? 1 : 0);
  }
  const best = ranked[0] ?? null;
  return { person: best, how: best ? "ranked" : "none" };
}

export type DraftBreakdown = { signal_strength: number; person_fit: number; recency: number; relationship_path: number };

/**
 * How an analysis draft is scored, in the same four parts as a signal draft
 * so the desk sorts and decays it the same way: the fit the synthesizer
 * gave, the person the synthesizer chose (a decision owner by definition),
 * today's recency, and the warm path on file.
 */
export function draftBreakdown(fit: number, pathScore: number | null, observedAt: string): DraftBreakdown {
  const clamped = Math.max(0, Math.min(100, Math.round(fit)));
  return {
    signal_strength: Math.round(clamped * 0.4),
    person_fit: 30,
    recency: recency(observedAt),
    relationship_path: Math.min(10, Math.max(0, Math.round(pathScore ?? 0))),
  };
}

export function scoreOfBreakdown(breakdown: DraftBreakdown) {
  return breakdown.signal_strength + breakdown.person_fit + breakdown.recency + breakdown.relationship_path;
}

export type AnalysisRole = { title: string; url: string | null; posted_at: string | null; why: string };
export type PostingRow = { title: string; url: string; posted_at: string | null; family: JobFamily | null; description: string | null };

/** The roles the hiring agent read from job boards, as posting rows: only ones with a real URL, each classified by title. */
export function analysisRolesToPostings(roles: AnalysisRole[]): PostingRow[] {
  const seen = new Set<string>();
  const out: PostingRow[] = [];
  for (const role of roles) {
    const url = (role.url ?? "").trim().split("#")[0];
    if (!/^https?:\/\/\S+$/i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const postedAt = role.posted_at && /^\d{4}-\d{2}-\d{2}/.test(role.posted_at) ? role.posted_at.slice(0, 10) : null;
    out.push({ title: role.title.trim(), url, posted_at: postedAt, family: classifyTitle(role.title), description: role.why?.trim() || null });
  }
  return out;
}

export type DraftChannel = "linkedin_first" | "email_first" | "intro" | "linkedin_only";

/** The channel from what is actually on file, whatever the model proposed. */
export function channelFor(person: Pick<DraftCandidate, "email" | "email_status" | "linkedin_url" | "path_score">, theirPost: boolean): DraftChannel {
  if ((person.path_score ?? 0) >= 10) return "intro";
  if (!person.email) return "linkedin_only";
  if (person.email_status === "verified" && !theirPost) return "email_first";
  return "linkedin_first";
}
