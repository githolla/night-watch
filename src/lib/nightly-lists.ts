import type { SupabaseClient } from "@supabase/supabase-js";
import { setNightlyLists, type ListOffer, type ListOwnerKey, type ListRow } from "./research-data/server.ts";

const TTL_MS = 60_000;
const KEEP_DAYS = 30;
let loadedAt = 0;
let inflight: Promise<void> | null = null;

/**
 * Read the ready nightly lists from the last month into the research data, so list lookups (the desk,
 * card preparation, the research panel) see them like the curated batch files. Cached for a minute per
 * server instance; `force` after a list is written. Before migration 0027 the table is missing and the
 * lists simply stay empty.
 */
export function loadNightlyLists(db: SupabaseClient, options: { force?: boolean } = {}): Promise<void> {
  if (!options.force && Date.now() - loadedAt < TTL_MS) return Promise.resolve();
  if (inflight && !options.force) return inflight;
  const run = (async () => {
    const since = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await db.from("reachout_lists").select("list_date,owner,rows,offers").eq("status", "ready").gte("list_date", since).order("list_date", { ascending: false });
    loadedAt = Date.now();
    if (error) return;
    const focus: ListRow[] = [];
    const offers: ListOffer[] = [];
    const latest: Record<ListOwnerKey, string[]> = { josh: [], suuchi: [] };
    const seen = new Set<string>();
    for (const list of data ?? []) {
      const owner: ListOwnerKey = list.owner === "josh" ? "josh" : "suuchi";
      const rows = (list.rows ?? []) as ListRow[];
      if (!latest[owner].length && rows.length) latest[owner] = rows.map((row) => row.domain);
      // Newest list wins if a company ever appeared twice.
      for (const row of rows) if (!seen.has(row.domain.toLowerCase())) { seen.add(row.domain.toLowerCase()); focus.push(row); }
      offers.push(...((list.offers ?? []) as ListOffer[]));
    }
    setNightlyLists({ nightlyFocus: focus, nightlyOffers: offers, nightlyLatest: latest });
  })().finally(() => { if (inflight === run) inflight = null; });
  inflight = run;
  return run;
}
