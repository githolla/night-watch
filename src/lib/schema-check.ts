import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResearchError } from "./research-errors.ts";

/**
 * Each migration after the original schema, with a cheap probe that fails
 * until it is applied. A page or run that would otherwise die with a
 * redacted server error instead says which file to apply.
 */
const MIGRATIONS: Array<{ file: string; table: string; column: string; adds: string }> = [
  { file: "0004_run_accounts.sql", table: "run_accounts", column: "id", adds: "run records with one row per company" },
  { file: "0005_job_sweep.sql", table: "job_postings", column: "id", adds: "job postings and the careers sweep" },
  { file: "0006_sweep_sources.sql", table: "job_postings", column: "source", adds: "posting sources, salary and description" },
  { file: "0007_posts_and_contacts.sql", table: "public_posts", column: "id", adds: "AI posts and contact enrichment" },
  { file: "0008_account_intel.sql", table: "accounts", column: "intel_score", adds: "the per-company intelligence score" },
  { file: "0009_outreach_tiers.sql", table: "accounts", column: "outreach", adds: "the reach-out tiers and the Tier A list" },
  { file: "0010_analysis.sql", table: "accounts", column: "analysis", adds: "the deep analysis per company" },
  { file: "0011_contact_details.sql", table: "people", column: "phone", adds: "phone numbers and contact notes from the contact agent" },
  { file: "0012_analysis_drafts.sql", table: "cards", column: "linkedin_message", adds: "drafts written from the analysis, a LinkedIn message on every draft, and roles read from job boards" },
  { file: "0013_linkedin_cooldown.sql", table: "accounts", column: "linkedin_checked_at", adds: "the LinkedIn discovery cooldown so profile and post search stops re-running on every sweep" },
  { file: "0014_sender_profile.sql", table: "sender_profiles", column: "owner", adds: "the sender identity (name, title, signature, CC) applied to outreach emails" },
  { file: "0015_card_claim.sql", table: "cards", column: "working_at", adds: "the in-progress marker so two people don't message the same prospect" },
  { file: "0016_linkedin_subject.sql", table: "cards", column: "linkedin_subject", adds: "a subject line on the LinkedIn draft (used for InMail)" },
  { file: "0017_google_scopes.sql", table: "gmail_connections", column: "scopes", adds: "the granted Google scopes and Calendar flag per connected sender" },
  { file: "0018_scheduling.sql", table: "cards", column: "proposed_times", adds: "the meeting times offered and the booked calendar invite for auto-scheduling on reply" },
  { file: "0019_users.sql", table: "app_users", column: "email", adds: "per-user sign-ons (email + password) with a sending seat and role" },
  { file: "0020_invites_signature.sql", table: "app_users", column: "invite_token", adds: "invite links for new teammates and website/location fields for the branded signature" },
  { file: "0021_pipeline.sql", table: "cards", column: "qualified_at", adds: "post-outreach pipeline stages (qualified/opportunity) and timestamps for conversion tracking" },
  { file: "0022_feedback.sql", table: "feedback", column: "message", adds: "tester feedback captured per page, with CSV export for admins" },
];

export type PendingMigration = { file: string; adds: string; reason: string; sql: string };

function migrationSql(file: string) {
  try {
    return readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
  } catch {
    return `-- supabase/migrations/${file} (not readable from this deploy; copy it from the repository)`;
  }
}

let cached: { at: number; pending: PendingMigration[] } | null = null;

/** Migrations under supabase/migrations that the connected database has not applied. Cached for a minute per server. */
export async function pendingMigrations(db: SupabaseClient, now = Date.now()): Promise<PendingMigration[]> {
  if (cached && now - cached.at < 60_000 && cached.pending.length === 0) return [];
  const pending: PendingMigration[] = [];
  for (const migration of MIGRATIONS) {
    const { error } = await db.from(migration.table).select(migration.column).limit(1);
    if (error) pending.push({ file: migration.file, adds: migration.adds, reason: error.message, sql: migrationSql(migration.file) });
  }
  cached = { at: now, pending };
  return pending;
}

/** Throw a config error naming the pending migrations, for run routes. */
export async function requireSchema(db: SupabaseClient) {
  const pending = await pendingMigrations(db);
  if (!pending.length) return;
  throw new ResearchError("config", `The database is behind the code. Apply ${pending.map((item) => `supabase/migrations/${item.file}`).join(", ")} in the Supabase SQL editor, then retry. (${pending[0].reason})`);
}
