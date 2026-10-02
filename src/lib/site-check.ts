/**
 * A free homepage check for a sourced company before any money is spent on it: does the domain exist, does
 * it still belong to the company, and has it moved. Pure apart from the injected fetcher and DNS lookup; no
 * path aliases, so node tests can import it.
 */
import { safeFetch, type Fetcher, type Lookup } from "./evidence-grounding.ts";

export const SITE_CHECK_TIMEOUT_MS = 5_000;
export const SITE_CHECK_MAX_BYTES = 200_000;
const TEXT_WINDOW = 50_000;

export type SiteCheck =
  | { action: "keep"; domain: string; confirmed: true; movedFrom?: string }
  | { action: "unconfirmed"; domain: string; reason: string }
  | { action: "drop"; reason: string };

/** Rankings, directories, social sites and parked-domain hosts: a company homepage never redirects to one. */
const NOT_A_COMPANY = [
  "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "yelp.com", "bbb.org", "google.com",
  "godaddy.com", "sedo.com", "sedoparking.com", "parkingcrew.net", "bodis.com", "dan.com", "afternic.com", "hugedomains.com", "namecheap.com", "parked.com", "above.com",
  "wikipedia.org", "zoominfo.com", "dnb.com", "bloomberg.com", "forbes.com", "inc.com", "bizjournals.com", "enr.com", "landscapemanagement.net", "crainsnewyork.com", "chicagobusiness.com",
];

const TWO_PART_SUFFIX = /^(co|com|org|net|ac|gov|edu)$/;

/** The registrable part of a host: "shop.acme.com" is "acme.com", "acme.co.uk" stays "acme.co.uk". */
export function registrableDomain(hostname: string) {
  const labels = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const take = labels[labels.length - 1].length === 2 && TWO_PART_SUFFIX.test(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-take).join(".");
}

const isNotACompany = (domain: string) => NOT_A_COMPANY.some((blocked) => domain === blocked || domain.endsWith(`.${blocked}`));

const FILLER = new Set(["inc", "incorporated", "llc", "ltd", "co", "company", "corp", "corporation", "group", "services", "service", "the", "and", "of", "lp", "llp", "pllc"]);

/** The words of a company name that could identify it on its own site. */
export function nameTokens(company: string) {
  return [...new Set(company.toLowerCase().replace(/&/g, " ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").split(" ").filter((word) => word.length >= 3 && !FILLER.has(word)))];
}

const squash = (value: string) => value.toLowerCase().replace(/&amp;/g, "&").replace(/&#39;|&#x27;|&rsquo;|['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Title, og:site_name and the first 50KB of visible text (footer copyright lines included), flattened. */
function pageWords(html: string) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const site = /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i.exec(html)?.[1] ?? "";
  const visible = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").slice(0, TEXT_WINDOW);
  const footer = html.slice(-TEXT_WINDOW).replace(/<[^>]+>/g, " ");
  return ` ${squash(`${title} ${site} ${visible} ${footer}`)} `;
}

/** Some distinctive word of the name is on the page or in the domain label. */
export function namesCompany(html: string, domain: string, company: string) {
  const tokens = nameTokens(company);
  if (!tokens.length) return true;
  const words = pageWords(html);
  const label = registrableDomain(domain).split(".")[0].replace(/[^a-z0-9]/g, "");
  return tokens.some((token) => words.includes(` ${token} `) || label.includes(token));
}

/** Wrap a fetcher so a refused connection keeps its error code in the message safeFetch reports, and remember the last URL asked for. */
function trackingFetcher(fetcher: Fetcher) {
  const state = { lastUrl: "" };
  const wrapped: Fetcher = async (url, init) => {
    state.lastUrl = url;
    try {
      return await fetcher(url, init);
    } catch (error) {
      const code = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
      if (error instanceof Error && typeof code === "string" && error.name !== "AbortError") throw new Error(`${code}: ${error.message}`);
      throw error;
    }
  };
  return { wrapped, state };
}

const hostOf = (url: string, fallback: string) => {
  try { return new URL(url).hostname.toLowerCase(); } catch { return fallback; }
};

export type SiteCheckOptions = {
  lookup?: Lookup; signal?: AbortSignal; timeoutMs?: number;
  /** The free MX check: a domain that explicitly accepts no mail (false) is dropped; null (could not tell) is kept. */
  mailHost?: (domain: string) => Promise<boolean | null>;
};

const UNREACHABLE = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|connection refused/i;

/**
 * One GET to https://<domain>: 5 s, 200KB. A dead domain, a redirect to a social, ranking or parking site, or
 * a working page that never names the company is dropped. A redirect to another company domain moves the
 * candidate there (the caller re-runs its known and syntax checks). A blocked, rate-limited, failing or slow
 * site is kept as unconfirmed. With `mailHost`, a domain that accepts no email is dropped too.
 */
export async function verifySite(domain: string, company: string, fetcher: Fetcher = fetch, options: SiteCheckOptions = {}): Promise<SiteCheck> {
  const result = await checkHomepage(domain, company, fetcher, options);
  if (result.action === "drop" || !options.mailHost) return result;
  if (await options.mailHost(result.domain).catch(() => null) === false) return { action: "drop", reason: `${result.domain} does not accept email` };
  return result;
}

async function checkHomepage(domain: string, company: string, fetcher: Fetcher, options: SiteCheckOptions): Promise<SiteCheck> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? SITE_CHECK_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  const { wrapped, state } = trackingFetcher(fetcher);
  const page = await safeFetch(`https://${domain}/`, wrapped, { lookup: options.lookup, signal, maxBytes: SITE_CHECK_MAX_BYTES });
  // A redirect to a social, ranking or parking site is a drop however that site then answers.
  const reached = registrableDomain(hostOf(page.kind === "page" ? page.finalUrl : state.lastUrl, domain));
  const moved = reached !== registrableDomain(domain);
  if (moved && isNotACompany(reached)) return { action: "drop", reason: `${domain} redirects to ${reached}` };
  if (page.kind === "refused") {
    if (/does not resolve|private address/.test(page.reason)) return { action: "drop", reason: `${domain}: ${page.reason}` };
    return { action: "unconfirmed", domain, reason: page.reason };
  }
  if (page.kind === "failed") {
    if (!page.timeout && UNREACHABLE.test(page.reason)) return { action: "drop", reason: `${domain}: connection refused` };
    return { action: "unconfirmed", domain, reason: page.reason };
  }
  const current = moved ? reached : domain;
  if (page.status < 200 || page.status >= 300) return { action: "unconfirmed", domain: current, reason: `homepage returned ${page.status}` };
  if (!namesCompany(page.html, current, company)) return { action: "drop", reason: `${current} does not name ${company}` };
  return moved ? { action: "keep", domain: current, confirmed: true, movedFrom: domain } : { action: "keep", domain: current, confirmed: true };
}
