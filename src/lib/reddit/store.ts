import type { SupabaseClient } from "@supabase/supabase-js";
import { configSchema, defaultConfig, opportunitySchema, type RedditConfig } from "./domain.ts";
export function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
export async function loadConfig(db: SupabaseClient): Promise<RedditConfig> {
  const { data, error } = await db.from("reddit_config").select("config").eq("id", true).maybeSingle();
  check(error);
  return data ? configSchema.parse(data.config) : defaultConfig;
}
export async function loadOpportunities(db: SupabaseClient) {
  const { data, error } = await db.from("reddit_opportunities").select("*").order("created_at", { ascending: false }).limit(1000);
  check(error);
  return opportunitySchema.array().parse(data ?? []);
}
export async function purgeExpired(db: SupabaseClient, config: RedditConfig, now: number) {
  // Delete evidence and derivatives together; events cascade rather than retaining deleted Reddit text.
  const { error } = await db.from("reddit_opportunities").delete().lt("created_at", new Date(now - config.retention_days * 86400000).toISOString());
  check(error);
}
