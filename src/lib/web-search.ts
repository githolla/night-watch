/**
 * A plain web-search API, used to find LinkedIn profiles and posts by URL
 * pattern with no model in the loop. Serper (Google results) when
 * SERPER_API_KEY is set, otherwise Brave when BRAVE_API_KEY is set. With
 * neither, searches return nothing and the model-driven agents carry on.
 */
export type SearchHit = { title: string; url: string; snippet: string; date: string | null };

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
