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
