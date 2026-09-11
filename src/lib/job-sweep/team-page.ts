import type { Fetcher } from "./ats.ts";

/**
 * People named on the company's own site: leadership, team and about pages.
 * Rules only, no model. Names come from JSON-LD Person records when the page
 * has them, otherwise from a name-like line followed closely by a title-like
 * line, which is how nearly every team page is written.
 */
export type TeamPerson = { name: string; title: string; linkedin_url: string | null; source_url: string };

export const TEAM_PATHS = [
  "/leadership", "/leadership-team", "/our-leadership", "/about/leadership", "/about-us/leadership", "/company/leadership",
  "/team", "/our-team", "/meet-the-team", "/about/team", "/about-us/team", "/company/team", "/about/our-team",
  "/management", "/management-team", "/executive-team", "/executives", "/people", "/our-people", "/about/people",
  "/about", "/about-us", "/who-we-are", "/company",
];

const TITLE_WORDS = /\b(chief|officer|president|vice|vp|svp|evp|director|head|manager|partner|founder|co-founder|owner|principal|managing|ceo|coo|cfo|cto|cio|cro|cmo|chro|ciso|cpo|controller|counsel|lead|engineer|analyst|architect|administrator|specialist|coordinator|strategist|scientist|treasurer|secretary|chairman|chair|executive|associate|advisor|consultant|supervisor|superintendent)\b/i;
const NOT_A_NAME = /\b(about|read|more|contact|learn|view|our|team|the|and|we|us|you|your|meet|leadership|management|board|careers|services|solutions|company|group|inc|llc|ltd|corp|news|blog|home|menu|search|login|sign|get|start|why|how|what|who|where|when|privacy|terms|policy|all|rights|reserved|copyright)\b/i;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&#8217;": "'", "&rsquo;": "'", "&#8211;": "-", "&ndash;": "-", "&#8212;": "-", "&mdash;": "-" };

function decode(value: string) {
  return value.replace(/&(amp|lt|gt|quot|#39|apos|nbsp|#8217|rsquo|#8211|ndash|#8212|mdash);/g, (match) => ENTITIES[match] ?? match).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

/** Visible text runs in document order, scripts and styles removed. */
export function textRuns(html: string) {
  const stripped = html.replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<br\s*\/?>/gi, "\n");
  return stripped.split(/<[^>]+>/).flatMap((run) => run.split(/\n/)).map((run) => decode(run).replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function looksLikeName(run: string) {
  if (run.length > 40 || /\d|@|\||:/.test(run)) return false;
  const words = run.replace(/,.*$/, "").split(/\s+/).filter((word) => !/^(jr\.?|sr\.?|ii|iii|iv|phd|cpa|mba|esq\.?)$/i.test(word));
  if (words.length < 2 || words.length > 4) return false;
  if (NOT_A_NAME.test(run) || TITLE_WORDS.test(run)) return false;
  return words.every((word) => /^[A-Z][A-Za-z'’.-]+$/.test(word) || /^[A-Z]\.?$/.test(word));
}

export function looksLikeTitle(run: string) {
  return run.length >= 3 && run.length <= 90 && TITLE_WORDS.test(run) && !/\.\s+\w+\s+\w+\s+\w+/.test(run);
}

/** Names and titles from a team page's HTML. */
export function peopleFromHtml(html: string, pageUrl: string): TeamPerson[] {
  const found = new Map<string, TeamPerson>();
  const add = (name: string, title: string, linkedin: string | null) => {
    const key = name.toLowerCase();
    if (!found.has(key)) found.set(key, { name: name.replace(/,.*$/, "").trim(), title: title.trim(), linkedin_url: linkedin, source_url: pageUrl });
  };
  // JSON-LD Person records first: they are unambiguous.
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]) as unknown;
      const stack: unknown[] = [parsed];
      while (stack.length) {
        const node = stack.pop();
        if (Array.isArray(node)) { stack.push(...node); continue; }
        if (!node || typeof node !== "object") continue;
        const record = node as Record<string, unknown>;
        const type = record["@type"];
        if ((type === "Person" || (Array.isArray(type) && type.includes("Person"))) && typeof record.name === "string" && typeof record.jobTitle === "string" && looksLikeName(record.name)) {
          const same = typeof record.sameAs === "string" ? [record.sameAs] : Array.isArray(record.sameAs) ? record.sameAs.filter((value): value is string => typeof value === "string") : [];
          add(record.name, record.jobTitle, same.find((url) => /linkedin\.com\/in\//i.test(url)) ?? null);
        }
        for (const value of Object.values(record)) if (value && typeof value === "object") stack.push(value);
      }
    } catch {
      // Not JSON; fall through to the text scan.
    }
  }
  // Then the text: a name followed within two runs by a title.
  const runs = textRuns(html);
  for (let index = 0; index < runs.length; index += 1) {
    if (!looksLikeName(runs[index])) continue;
    const title = [runs[index + 1], runs[index + 2]].find((run) => run && looksLikeTitle(run) && !looksLikeName(run));
    if (title) add(runs[index], title, null);
  }
  return [...found.values()].slice(0, 60);
}

/** Team-page links on any page, so a homepage points the way. */
export function teamLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(/<a[^>]+href=["']([^"'#?]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!/leadership|our team|meet the team|management|executive|our people|who we are/i.test(`${href} ${label}`)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (url.hostname.replace(/^www\./, "") === new URL(baseUrl).hostname.replace(/^www\./, "")) links.push(url.toString());
    } catch {
      // Not a URL.
    }
  }
  return [...new Set(links)].slice(0, 6);
}

/**
 * Read the likely team pages for a domain and return everyone named with a
 * title. Stops after the first page that yields people, plus any leadership
 * page linked from it, so a site with both is read once each.
 */
export async function scrapeTeamPeople(domain: string, fetcher: Fetcher, limitPages = 10): Promise<{ people: TeamPerson[]; pagesRead: number }> {
  const bases = [`https://www.${domain}`, `https://${domain}`];
  const seen = new Set<string>();
  const people = new Map<string, TeamPerson>();
  let pagesRead = 0;
  const read = async (url: string) => {
    if (seen.has(url) || pagesRead >= limitPages) return null;
    seen.add(url);
    try {
      const response = await fetcher(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; NightWatch/1.0)" }, signal: AbortSignal.timeout(12_000) });
      pagesRead += 1;
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  };
  for (const base of bases) {
    const home = await read(`${base}/`);
    if (home === null) continue;
    const queue = [...teamLinks(home, `${base}/`), ...TEAM_PATHS.map((path) => `${base}${path}`)];
    for (const url of queue) {
      const html = await read(url);
      if (!html) continue;
      for (const person of peopleFromHtml(html, url)) if (!people.has(person.name.toLowerCase())) people.set(person.name.toLowerCase(), person);
      // A generic about page rarely lists everyone; keep going through the leadership-style paths while cheap.
      if (people.size >= 8) break;
    }
    if (people.size) break;
  }
  return { people: [...people.values()], pagesRead };
}
