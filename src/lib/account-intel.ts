import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One number per company that says how much reason there is to talk to
 * them, computed from what the sweep found. Stored on accounts so lists
 * sort and filter by it in one query and the nightly research goes to the
 * hottest companies first. Transparent on purpose; see intelScore().
 */
export type IntelInputs = {
  openTargetRoles: number;
  /** Distinct target families among open roles. */
  targetFamilies: number;
  /** Days since the newest target role was posted or first seen; null when none. */
  newestRoleAgeDays: number | null;
  aiPosts: number;
  /** Days since the newest AI post; null when none. */
  newestPostAgeDays: number | null;
  contacts: number;
  verifiedEmails: number;
  openCards: number;
};

export type IntelBreakdown = { roles: number; posts: number; contacts: number; cards: number; total: number };

function recencyFactor(ageDays: number | null) {
  if (ageDays === null) return 0;
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.8;
  if (ageDays <= 90) return 0.5;
  return 0.25;
}

/**
 * 0–100. Roles up to 45 (12 per role, +6 per extra family, scaled by how
 * fresh the newest is), posts up to 30 (15 per post, scaled by freshness),
 * contacts up to 15 (verified email 15, any contact 6), open dossiers 10.
 */
export function intelScore(input: IntelInputs): IntelBreakdown {
  const roleBase = Math.min(45, input.openTargetRoles * 12 + Math.max(0, input.targetFamilies - 1) * 6);
  const roles = Math.round(roleBase * Math.max(0.5, recencyFactor(input.newestRoleAgeDays)));
  const posts = Math.round(Math.min(30, input.aiPosts * 15) * Math.max(0.5, recencyFactor(input.newestPostAgeDays)));
  const contacts = input.verifiedEmails > 0 ? 15 : input.contacts > 0 ? 6 : 0;
  const cards = Math.min(10, input.openCards * 10);
  const total = Math.min(100, roles + posts + contacts + cards);
  return { roles, posts, contacts, cards, total };
}

function ageDays(date: string | null | undefined, now: Date) {
  if (!date) return null;
  const time = Date.parse(date);
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now.getTime() - time) / 86_400_000));
}

/** Recompute and store the score, the counts behind it, and when this company last changed. */
export async function recomputeAccountIntel(db: SupabaseClient, accountId: string, now = new Date()) {
  const [{ data: roles }, { data: posts }, { data: people }, { count: openCards }] = await Promise.all([
    db.from("job_postings").select("family,posted_at,first_seen_at").eq("account_id", accountId).eq("active", true).not("family", "is", null),
    db.from("public_posts").select("posted_at,created_at").eq("account_id", accountId),
    db.from("people").select("email_status,enriched_at,created_at").eq("account_id", accountId).eq("do_not_contact", false),
    db.from("cards").select("*", { count: "exact", head: true }).eq("account_id", accountId).in("status", ["new", "approved", "edited"]),
  ]);
  const roleDates = (roles ?? []).map((row) => (row.posted_at as string | null) ?? (row.first_seen_at as string));
  const postDates = (posts ?? []).map((row) => (row.posted_at as string | null) ?? (row.created_at as string));
  const peopleDates = (people ?? []).map((row) => (row.enriched_at as string | null) ?? (row.created_at as string));
  const newest = (dates: string[]) => dates.map((date) => Date.parse(date)).filter((time) => !Number.isNaN(time)).sort((a, b) => b - a)[0];
  const input: IntelInputs = {
    openTargetRoles: roles?.length ?? 0,
    targetFamilies: new Set((roles ?? []).map((row) => row.family as string)).size,
    newestRoleAgeDays: ageDays(newest(roleDates) ? new Date(newest(roleDates)).toISOString() : null, now),
    aiPosts: posts?.length ?? 0,
    newestPostAgeDays: ageDays(newest(postDates) ? new Date(newest(postDates)).toISOString() : null, now),
    contacts: people?.length ?? 0,
    verifiedEmails: (people ?? []).filter((row) => row.email_status === "verified").length,
    openCards: openCards ?? 0,
  };
  const score = intelScore(input);
  const lastChange = [newest(roleDates), newest(postDates), newest(peopleDates)].filter((time): time is number => Boolean(time)).sort((a, b) => b - a)[0];
  await db.from("accounts").update({
    intel_score: score.total,
    intel_breakdown: { ...score, ...input },
    open_target_roles: input.openTargetRoles,
    ai_posts: input.aiPosts,
    contacts: input.contacts,
    verified_emails: input.verifiedEmails,
    last_change_at: lastChange ? new Date(lastChange).toISOString() : null,
    intel_updated_at: now.toISOString(),
  }).eq("id", accountId);
  return { score, input };
}
