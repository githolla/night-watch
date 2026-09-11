/**
 * Find a likely buyer by title at a domain. The Apollo people-search
 * endpoint returns names and titles but not emails; the existing
 * matchPerson() enrichment fills the email in afterwards.
 */
export type ApolloCandidate = { name: string; title: string; linkedin_url: string | null };

export async function searchPeopleByTitle(domain: string, titles: string[]): Promise<ApolloCandidate | null> {
  return (await searchPeopleByTitles(domain, titles, 1))[0] ?? null;
}

/** Up to `limit` likely buyers at the domain, best title match first. */
export async function searchPeopleByTitles(domain: string, titles: string[], limit = 3): Promise<ApolloCandidate[]> {
  if (!process.env.APOLLO_API_KEY || !titles.length) return [];
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
  const out: ApolloCandidate[] = [];
  for (const person of ranked) {
    const name = (person.name ?? [person.first_name, person.last_name].filter(Boolean).join(" ")).trim();
    if (!name || !person.title) continue;
    out.push({ name, title: person.title, linkedin_url: person.linkedin_url ?? null });
    if (out.length >= limit) break;
  }
  return out;
}

function rank(title: string | undefined, titles: string[]) {
  if (!title) return titles.length;
  const lower = title.toLowerCase();
  const index = titles.findIndex((wanted) => lower.includes(wanted.toLowerCase()));
  return index === -1 ? titles.length : index;
}
