import { isRoleAddress } from "./clean.ts";
import { buildEmail, localPart, PATTERN_KEYS, type PatternKey } from "./email-pattern.ts";
import { safeFetch, type Fetcher, type Lookup } from "./evidence-grounding.ts";
import { pageEmails, type PageEmail } from "./page-emails.ts";

/**
 * Find a person's real address on their company's own website, the way the address routine does, but
 * inside the app and at no model cost: read the home, team, staff, about and contact pages (and the links
 * the site itself gives to them), then either find the person's own address, or read the names next to
 * colleagues' addresses to prove the company's format. The result is the same evidence the routine sends,
 * so the app's own check (importAddressEvidence) re-reads the pages before anything is trusted.
 */

export type FoundEvidence =
  | { kind: "published"; address: string; sourceUrl: string }
  | { kind: "format"; address: string; examples: Array<{ name: string; email: string; sourceUrl: string }> };
export type FinderResult =
  | { kind: "evidence"; evidence: FoundEvidence }
  | { kind: "no-mail" }
  | { kind: "none"; pagesRead: number; addressesSeen: number };
export type FinderDeps = { fetcher?: Fetcher; lookup?: Lookup; mailHost?: (domain: string) => Promise<boolean | null>; maxPages?: number };

const PATHS = ["", "contact", "contact-us", "about", "about-us", "team", "our-team", "leadership", "staff", "meet-the-team", "management", "our-people", "people", "who-we-are", "company"];
const LINK_HINT = /team|staff|leader|about|contact|people|management|who-we-are|our-company|directory|employees/i;
/**
 * Possible names written just before an address, nearest first: every pair of adjacent capitalised words
 * (and first, middle initial, last). Pairs overlap, so "Call Sam Patel" still yields "Sam Patel"; a pair
 * that is not a name ("Office Manager") is harmless, because it only counts if it builds the address.
 */
export function namesBefore(text: string): string[] {
  const words = [...text.matchAll(/[A-Z][a-zA-Z'’-]*\.?/g)].map((match) => ({ word: match[0], start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }));
  const adjacent = (a: { end: number }, b: { start: number }) => /^\s+$/.test(text.slice(a.end, b.start));
  const names: string[] = [];
  for (let i = words.length - 1; i > 0; i--) {
    const [a, b] = [words[i - 1], words[i]];
    if (!adjacent(a, b) || /\.$/.test(b.word)) continue;
    if (/^[A-Z]\.$/.test(a.word) && i > 1 && adjacent(words[i - 2], a)) names.push(`${words[i - 2].word} ${a.word} ${b.word}`);
    else if (!/\.$/.test(a.word)) names.push(`${a.word} ${b.word}`);
  }
  return names.slice(0, 8);
}

/** Which name format an address follows for a name next to it, if any. */
function formatFor(item: PageEmail): { name: string; key: PatternKey } | null {
  const local = item.email.split("@")[0];
  for (const name of namesBefore(item.before)) for (const key of PATTERN_KEYS) if (key !== "last" && localPart(name, key) === local) return { name, key };
  return null;
}

async function readSite(domain: string, deps: FinderDeps) {
  const max = deps.maxPages ?? 18;
  const fetchOne = (url: string) => safeFetch(url, deps.fetcher, { ...(deps.lookup ? { lookup: deps.lookup } : {}), maxBytes: 3_000_000, signal: AbortSignal.timeout(8_000) });
  const home = await fetchOne(`https://${domain}/`);
  const origin = home.kind === "page" && home.html ? new URL(home.finalUrl).origin : `https://${domain}`;
  const urls = new Set(PATHS.slice(1).map((path) => `${origin}/${path}`));
  // The site's own links to its team and contact pages find what fixed paths miss (/our-story/leadership).
  if (home.kind === "page") for (const match of home.html.matchAll(/href="([^"#]+)"/gi)) {
    try { const url = new URL(match[1], origin); if (url.origin === origin && LINK_HINT.test(url.pathname)) urls.add(url.toString().replace(/\/$/, "")); } catch { /* not a link */ }
  }
  const pages: Array<{ url: string; html: string }> = home.kind === "page" && home.html ? [{ url: home.finalUrl, html: home.html }] : [];
  const queue = [...urls].slice(0, max - 1);
  for (let i = 0; i < queue.length; i += 4) {
    const batch = await Promise.all(queue.slice(i, i + 4).map(async (url) => ({ url, page: await fetchOne(url) })));
    for (const { url, page } of batch) if (page.kind === "page" && page.status === 200 && page.html) pages.push({ url: page.finalUrl || url, html: page.html });
  }
  return pages;
}

export async function findAddress(input: { name: string; domain: string; avoid?: string | null }, deps: FinderDeps = {}): Promise<FinderResult> {
  const domain = input.domain.toLowerCase().replace(/^www\./, "");
  if (deps.mailHost && (await deps.mailHost(domain)) === false) return { kind: "no-mail" };
  const avoid = input.avoid?.toLowerCase() ?? null;
  const pages = await readSite(domain, deps);
  const found: Array<PageEmail & { url: string }> = [];
  for (const page of pages) for (const item of pageEmails(page.html, domain)) if (!found.some((seen) => seen.email === item.email)) found.push({ ...item, url: page.url });
  const personal = found.filter((item) => !isRoleAddress(item.email));
  // Their own address, in any common format.
  const theirs = new Set(PATTERN_KEYS.map((key) => buildEmail(input.name, key, domain)).filter((email): email is string => Boolean(email) && email !== avoid));
  const own = personal.find((item) => theirs.has(item.email));
  if (own) return { kind: "evidence", evidence: { kind: "published", address: own.email, sourceUrl: own.url } };
  // Two colleagues whose names sit next to their addresses prove the format.
  const byKey = new Map<PatternKey, Array<{ name: string; email: string; sourceUrl: string }>>();
  for (const item of personal) {
    const match = formatFor(item);
    if (match) byKey.set(match.key, [...(byKey.get(match.key) ?? []), { name: match.name, email: item.email, sourceUrl: item.url }]);
  }
  const [best] = [...byKey.entries()].filter(([, examples]) => examples.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const address = best ? buildEmail(input.name, best[0], domain) : null;
  if (best && address && address !== avoid) return { kind: "evidence", evidence: { kind: "format", address, examples: best[1].slice(0, 4) } };
  return { kind: "none", pagesRead: pages.length, addressesSeen: found.length };
}
