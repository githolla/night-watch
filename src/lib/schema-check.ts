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

/**
 * Diagnostic-only probe list. Deliberately separate from MIGRATIONS above, which GATES every page — adding
 * an unapplied migration there turns the whole app into a "apply this migration" wall. This list is read
 * only by /api/health, so it can safely cover:
 *   - the three migrations MIGRATIONS never probes at all (0002, 0003, 0023), and
 *   - columns added by a trailing `alter table` in a migration whose `create table` already succeeded — a
 *     half-applied migration passes the gate above while silently breaking writes.
 * A missing column here does NOT throw on a PostgREST write; supabase-js returns { error } and nearly every
 * call site ignores it, so the failure is a silent no-op. That is how a missing touches.experiment_variant_id
 * broke every send's History logging with nothing surfacing in the UI.
 */
const HEALTH_PROBES: Array<{ file: string; table: string; column: string; breaks: string }> = [
  { file: "0002_cadences.sql", table: "cadences", column: "id", breaks: "follow-up sequences: none are ever created, the follow-up cron fails every run, /followups renders empty" },
  { file: "0002_cadences.sql", table: "cadence_steps", column: "id", breaks: "follow-up steps: the cadence planner saves nothing and 'mark step sent' silently does nothing" },
  { file: "0003_message_experiments.sql", table: "touches", column: "experiment_variant_id", breaks: "logging a send to History (the reported incident), and the Message Lab" },
  { file: "0003_message_experiments.sql", table: "cards", column: "active_variant_id", breaks: "Message Lab: picking a winning variant silently fails to save the draft" },
  { file: "0023_worklist.sql", table: "cards", column: "worklist_on", breaks: "today's worklist: the desk list is empty and reshuffles on every load" },
  { file: "0017_google_scopes.sql", table: "gmail_connections", column: "connected_at", breaks: "the send warm-up cap and the From address on every email" },
  { file: "0020_invites_signature.sql", table: "sender_profiles", column: "website", breaks: "the signature block on every outbound email" },
  { file: "0018_scheduling.sql", table: "cards", column: "invite_link", breaks: "auto-booking a meeting when a prospect picks a proposed time" },
  { file: "0015_card_claim.sql", table: "cards", column: "working_at", breaks: "the 'someone is working this' marker, so two people can message the same prospect" },
];

export type SchemaProbe = { file: string; table: string; column: string; breaks: string; ok: boolean };

/** Probe the columns that break things silently. Read-only, never throws, never gates a page. */
export async function schemaHealth(db: SupabaseClient): Promise<{ ok: boolean; missing: SchemaProbe[] }> {
  const results = await Promise.all(HEALTH_PROBES.map(async (probe) => {
    try {
      const { error } = await db.from(probe.table).select(probe.column).limit(1);
      return { ...probe, ok: !error };
    } catch { return { ...probe, ok: false }; }
  }));
  const missing = results.filter((probe) => !probe.ok);
  return { ok: missing.length === 0, missing };
}

export type PendingMigration = { file: string; adds: string; reason: string; sql: string };

function migrationSql(file: string) {
  try {
    return readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
  } catch {
    return `-- supabase/migrations/${file} (not readable from this deploy; copy it from the repository)`;
  }
}

let cached: { at: number; pending: PendingMigration[] } | null = null;

/** Migrations under supabase/migrations that the connected database has not applied. Cached for a minute per server.
 *  Probes run in parallel (one round-trip, not one-per-migration) and the result is cached whether or not
 *  anything is pending, so a normal page load never pays for 18 sequential database queries. */
export async function pendingMigrations(db: SupabaseClient, now = Date.now()): Promise<PendingMigration[]> {
  if (cached && now - cached.at < 60_000) return cached.pending;
  // Fast path: migrations are applied in order, so if the newest one is present the rest are too —
  // one cheap query on the (normal) fully-migrated path. Only when it fails do we run the full scan
  // in parallel to name exactly what's missing.
  const newest = MIGRATIONS[MIGRATIONS.length - 1];
  const { error: newestError } = await db.from(newest.table).select(newest.column).limit(1);
  let pending: PendingMigration[] = [];
  if (newestError) {
    const probes = await Promise.all(
      MIGRATIONS.map(async (migration) => {
        const { error } = await db.from(migration.table).select(migration.column).limit(1);
        return error ? { file: migration.file, adds: migration.adds, reason: error.message, sql: migrationSql(migration.file) } : null;
      }),
    );
    pending = probes.filter((item): item is PendingMigration => item !== null);
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
