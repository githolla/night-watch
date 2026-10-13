import type { SupabaseClient } from "@supabase/supabase-js";
import { configSchema, defaultConfig, opportunitySchema } from "./domain.ts";
export function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
export async function loadConfig(db: SupabaseClient) { const { data, error } = await db.from("discovery_config").select("config").eq("id", true).maybeSingle(); check(error); return data ? configSchema.parse(data.config) : defaultConfig; }
export async function loadOpportunities(db: SupabaseClient) { const { data, error } = await db.from("discovery_opportunities").select("*").order("created_at", { ascending: false }).limit(1000); check(error); return opportunitySchema.array().parse(data ?? []); }
