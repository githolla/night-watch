import { z } from "zod";
import { runSearchAgent } from "./agents.ts";
import type { UsageRecorder } from "./anthropic-cost.ts";

/**
 * Web search as a function: a list of queries in, the raw hits out, read by
 * URL pattern afterwards. By default the searching is done by search agents
 * (the model with its web-search tool, ten queries per agent, agents in
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

/** One search agent runs up to ten queries and reports every result it saw, verbatim. */
async function agentBatch(queries: string[], model: string, recordUsage?: UsageRecorder): Promise<Record<string, SearchHit[]>> {
  const prompt = `You are a search agent. Run each of the following web searches exactly as written, one search each, and report the results verbatim: for every result give its title, its URL, and the snippet or description shown, plus the date if one is shown (YYYY-MM-DD). Report up to 10 results per query. Do not filter, judge or summarise; do not add results you did not see; keep URLs exactly as shown. Queries:\n${queries.map((query, index) => `${index + 1}. ${query}`).join("\n")}\n\nReturn JSON only: {"results":[{"query":"<the query as written>","hits":[{"title":"","url":"https://...","snippet":"","date":null}]}]}`;
  const json = await runSearchAgent(prompt, { model, maxSearches: Math.min(10, queries.length), maxTokens: 12_000 }, recordUsage);
  const parsed = agentOutput.parse(json);
  const out: Record<string, SearchHit[]> = {};
  for (const query of queries) out[query] = [];
  for (const result of parsed.results) {
    const key = queries.find((query) => query === result.query) ?? queries.find((query) => query.toLowerCase().includes(result.query.toLowerCase().slice(0, 40))) ?? result.query;
    out[key] = [...(out[key] ?? []), ...result.hits.filter((hit) => /^https?:\/\//i.test(hit.url))];
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
  const model = options.model ?? process.env.ANTHROPIC_SEARCH_MODEL ?? "claude-haiku-4-5";
  const batches: string[][] = [];
  for (let index = 0; index < unique.length; index += 10) batches.push(unique.slice(index, index + 10));
  const parallel = Math.max(1, options.parallel ?? 4);
  const out: Record<string, SearchHit[]> = {};
  for (let index = 0; index < batches.length; index += parallel) {
    const settled = await Promise.allSettled(batches.slice(index, index + parallel).map((batch) => agentBatch(batch, model, options.recordUsage)));
    for (const result of settled) if (result.status === "fulfilled") Object.assign(out, result.value);
  }
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
