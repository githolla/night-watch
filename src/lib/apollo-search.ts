/**
 * Find a likely buyer by title at a domain. The Apollo people-search
 * endpoint returns names and titles but not emails; the existing
 * matchPerson() enrichment fills the email in afterwards.
 */
export type ApolloCandidate = { name: string; title: string; linkedin_url: string | null };

export async function searchPeopleByTitle(domain: string, titles: string[]): Promise<ApolloCandidate | null> {
  if (!process.env.APOLLO_API_KEY || !titles.length) return null;
  const response = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.APOLLO_API_KEY },
    body: JSON.stringify({ q_organization_domains_list: [domain], person_titles: titles, per_page: 5, page: 1 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Apollo people search failed: ${response.status}`);
  const json = (await response.json()) as { people?: Array<{ name?: string; first_name?: string; last_name?: string; title?: string; linkedin_url?: string | null }> };
  const people = json.people ?? [];
  // Prefer the earliest title in the caller's list: the file ranks buyers by fit.
  const ranked = [...people].sort((left, right) => rank(left.title, titles) - rank(right.title, titles));
  const best = ranked[0];
  if (!best) return null;
  const name = best.name ?? [best.first_name, best.last_name].filter(Boolean).join(" ");
  if (!name.trim() || !best.title) return null;
  return { name: name.trim(), title: best.title, linkedin_url: best.linkedin_url ?? null };
}

function rank(title: string | undefined, titles: string[]) {
  if (!title) return titles.length;
  const lower = title.toLowerCase();
  const index = titles.findIndex((wanted) => lower.includes(wanted.toLowerCase()));
  return index === -1 ? titles.length : index;
}
