import { z } from "zod";
import { runSearchAgent } from "./agents.ts";
import type { UsageRecorder } from "./anthropic-cost.ts";
import { searchModel } from "./models.ts";

/**
 * Web search as a function: a list of queries in, the raw hits out, read by
 * URL pattern afterwards. By default the searching is done by search agents
 * (the model with its web-search tool, a few queries per agent, agents in
 * parallel), so nothing beyond the Anthropic key is needed. When
 * SERPER_API_KEY or BRAVE_API_KEY is set, that API is used instead.
 */
export type SearchHit = { title: string; url: string; snippet: string; date: string | null };

const agentOutput = z.object({
  results: z.array(z.object({
    query: z.string(),
    hits: z.array(z.object({ title: z.string().default(""), url: z.string(), snippet: z.string().default(""), date: z.string().nullable().default(null) })).default([]),
  })).default([]),
});

/** Queries per search agent. Fewer per agent keeps the verbatim answer well inside the output limit. */
export const QUERIES_PER_AGENT = 4;
/** Results the agent reports per query. */
const HITS_PER_QUERY = 8;

/** The host a `site:` operator in the query names, so the agent can be told to report only results from there. */
export function siteOf(query: string): string | null {
  const hosts = [...query.matchAll(/site:([a-z0-9.-]+\.[a-z]{2,})(?:\/[a-z0-9/_-]*)?/gi)].map((match) => match[1].toLowerCase());
  return hosts.length ? [...new Set(hosts)].join(" or ") : null;
}

/** Keep a hit only when it is a real URL and, for a site-scoped query, on that site. */
export function keepHit(hit: SearchHit, query: string) {
  if (!/^https?:\/\//i.test(hit.url)) return false;
  const wanted = [...query.matchAll(/site:([a-z0-9.-]+\.[a-z]{2,})/gi)].map((match) => match[1].toLowerCase());
  if (!wanted.length) return true;
  let host = "";
  try { host = new URL(hit.url).hostname.toLowerCase(); } catch { return false; }
  return wanted.some((site) => host === site || host.endsWith(`.${site}`));
}

/**
 * One search agent runs a few queries and reports every result it saw,
 * verbatim. The prompt names the site each query is scoped to, so the agent
 * does not pad the answer with results the reader would drop anyway.
 */
async function agentBatch(queries: string[], model: string, recordUsage?: UsageRecorder): Promise<Record<string, SearchHit[]>> {
  const lines = queries.map((query, index) => {
    const site = siteOf(query);
    return `${index + 1}. ${query}${site ? `  (report only results on ${site})` : ""}`;
  });
  const prompt = `You are a search agent. Run each of the following web searches exactly as written, one search each, and report the results verbatim: for every result give its title exactly as shown, its URL exactly as shown, the snippet or description shown, and the date if one is shown (YYYY-MM-DD). Report up to ${HITS_PER_QUERY} results per query. Do not filter by relevance, judge, or summarise; do not add results you did not see; do not shorten or rewrite titles; keep URLs exactly as shown. If a search returns nothing, report an empty hits list for it. Queries:\n${lines.join("\n")}\n\nReturn JSON only: {"results":[{"query":"<the query as written>","hits":[{"title":"","url":"https://...","snippet":"","date":null}]}]}`;
  const json = await runSearchAgent(prompt, { model, maxSearches: Math.min(10, queries.length), maxTokens: 16_000 }, recordUsage);
  const parsed = agentOutput.parse(json);
  const out: Record<string, SearchHit[]> = {};
  for (const query of queries) out[query] = [];
  for (const result of parsed.results) {
    const key = queries.find((query) => query === result.query) ?? queries.find((query) => query.toLowerCase().includes(result.query.toLowerCase().slice(0, 40))) ?? result.query;
    out[key] = [...(out[key] ?? []), ...result.hits.filter((hit) => keepHit(hit, key))];
  }
  return out;
}

/**
 * Run many queries. With a search API key, one call per query; otherwise
 * search agents take ten queries each and run side by side. Usage is
 * recorded so the run's cost stays honest.
 */
export async function runQueries(queries: string[], options: { model?: string; recordUsage?: UsageRecorder; parallel?: number } = {}): Promise<Record<string, SearchHit[]>> {
  const unique = [...new Set(queries.filter(Boolean))];
  if (searchProvider()) {
    const out: Record<string, SearchHit[]> = {};
    for (const query of unique) {
      try { out[query] = await webSearch(query, 10); } catch { out[query] = []; }
    }
    return out;
  }
  const model = options.model ?? searchModel();
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += QUERIES_PER_AGENT) batches.push(unique.slice(index, index + QUERIES_PER_AGENT));
  const parallel = Math.max(1, options.parallel ?? 4);
  const out: Record<string, SearchHit[]> = {};
  let fulfilled = 0;
  let firstError: unknown = null;
  for (let index = 0; index < batches.length; index += parallel) {
    const settled = await Promise.allSettled(batches.slice(index, index + parallel).map((batch) => agentBatch(batch, model, options.recordUsage)));
    settled.forEach((result, offset) => {
      if (result.status === "fulfilled") { Object.assign(out, result.value); fulfilled += 1; }
      else {
        if (!firstError) firstError = result.reason;
        console.warn(`[night-watch] search agent batch failed (${batches[index + offset].length} queries): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      }
    });
  }
  // Every batch failed: search is broken (web search disabled, model unavailable). Surface it instead of returning silent zeros.
  if (batches.length && fulfilled === 0 && firstError) throw firstError;
  return out;
}

export function searchProvider(): "serper" | "brave" | null {
  if (process.env.SERPER_API_KEY) return "serper";
  if (process.env.BRAVE_API_KEY) return "brave";
  return null;
}

export async function webSearch(query: string, count = 10): Promise<SearchHit[]> {
  const provider = searchProvider();
  if (!provider) return [];
  if (provider === "serper") {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST", headers: { "content-type": "application/json", "X-API-KEY": process.env.SERPER_API_KEY as string },
      body: JSON.stringify({ q: query, num: Math.min(count, 20) }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Serper search failed: ${response.status}`);
    const json = (await response.json()) as { organic?: Array<{ title?: string; link?: string; snippet?: string; date?: string }> };
    return (json.organic ?? []).filter((hit) => hit.link && hit.title).map((hit) => ({ title: hit.title as string, url: hit.link as string, snippet: hit.snippet ?? "", date: hit.date ?? null }));
  }
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(count, 20)));
  const response = await fetch(url, { headers: { accept: "application/json", "X-Subscription-Token": process.env.BRAVE_API_KEY as string }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Brave search failed: ${response.status}`);
  const json = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string; age?: string; page_age?: string }> } };
  return (json.web?.results ?? []).filter((hit) => hit.url && hit.title).map((hit) => ({ title: hit.title as string, url: hit.url as string, snippet: hit.description ?? "", date: hit.page_age ?? hit.age ?? null }));
}
