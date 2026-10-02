import type { AiFitEvidence, Grounding } from "./ai-fit.ts";

/**
 * Every AI-fit point must trace to a page the research actually saw. An evidence item whose URL a search
 * returned (or the model cited from those results) is "seen". Any other item gets one cheap page check:
 * "confirmed" when the page shows the claim, "dropped" when it is missing, gone or says something else, and
 * "unverified" when the page cannot be read (blocked, timed out, rendered by JavaScript). Scoring gives
 * dropped and unverified items nothing, so the list fails closed.
 *
 * Pure apart from the injected fetcher and DNS lookup; no path aliases, so node tests can import it.
 */

export type SeenSource = { url: string; title: string | null; page_age: string | null };

/** Query keys that identify a posting or page; every other query param (utm, tracking) is dropped. */
const IDENTIFYING_PARAMS = new Set(["jk", "vjk", "gh_jid", "jobid", "job_id", "id", "currentjobid", "p", "page_id"]);

/** Host plus path, lowercase host, no www, scheme, hash, tracking params or trailing slash. */
export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.replace(/\/+$/, "");
    const kept = [...url.searchParams.entries()].filter(([key]) => IDENTIFYING_PARAMS.has(key.toLowerCase())).sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${kept.map(([key, value]) => `${key.toLowerCase()}=${value}`).join("&")}` : "";
    return `${host}${path}${query}`;
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** Lowercase host without www, or null for anything that is not a URL. */
export function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const bareDomain = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:?#]/)[0];

/** The URL is on the company's own domain or one of its subdomains. */
export function onDomain(raw: string, domain: string | null | undefined): boolean {
  const host = hostOf(raw);
  const own = domain ? bareDomain(domain) : "";
  return Boolean(host && own && (host === own || host.endsWith(`.${own}`)));
}

/** Job boards and applicant tracking systems where a company's own postings live. */
export const JOB_BOARD_HOSTS = [
  "indeed.com", "linkedin.com", "ziprecruiter.com", "glassdoor.com", "greenhouse.io", "lever.co", "workable.com", "ashbyhq.com",
  "smartrecruiters.com", "icims.com", "myworkdayjobs.com", "paylocity.com", "paycomonline.net", "paycomonline.com", "adp.com",
  "ultipro.com", "ukg.net", "ukg.com", "dayforcehcm.com", "bamboohr.com", "applytojob.com", "jazzhr.com", "breezy.hr",
] as const;

/** A job-board or ATS page. LinkedIn counts only under /jobs, not profiles or posts. */
export function isJobBoardUrl(raw: string): boolean {
  const host = hostOf(raw);
  if (!host) return false;
  const board = JOB_BOARD_HOSTS.find((item) => host === item || host.endsWith(`.${item}`));
  if (!board) return false;
  if (board === "linkedin.com") {
    try { return /^\/jobs(\/|$)/.test(new URL(raw).pathname); } catch { return false; }
  }
  return true;
}

/** The URL points at a page, not a site's homepage. */
export function hasPath(raw: string): boolean {
  try {
    return new URL(raw).pathname.replace(/\/+$/, "").length > 0;
  } catch {
    return false;
  }
}

// ---------- safe page check ----------

export type Fetcher = (url: string, init: { redirect: "manual"; signal: AbortSignal; headers: Record<string, string> }) => Promise<Response>;
export type Lookup = (host: string) => Promise<string[]>;
export type PageResult =
  | { kind: "page"; status: number; finalUrl: string; html: string }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string; timeout: boolean };

export const PAGE_MAX_BYTES = 300_000;
export const PAGE_MAX_REDIRECTS = 3;

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (IPV4.test(value)) {
    const [a, b] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (value.includes(":")) return value === "::" || value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value);
  return false;
}

const defaultLookup: Lookup = async (host) => {
  const { lookup } = await import("node:dns/promises");
  return (await lookup(host, { all: true })).map((entry) => entry.address);
};

async function hostRefusal(url: URL, lookup: Lookup): Promise<string | null> {
  if (url.protocol !== "https:") return "only https pages are checked";
  if (url.username || url.password) return "credentials in the link";
  if (url.port && url.port !== "443") return "non-standard port";
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (IPV4.test(host) || host.includes(":")) return "IP address links are not checked";
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|localdomain|home|lan|corp)$/.test(host)) return "not a public host";
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return "host does not resolve";
  }
  if (!addresses.length) return "host does not resolve";
  if (addresses.some(isPrivateAddress)) return "host resolves to a private address";
  return null;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  const joined = new Uint8Array(Math.min(size, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, Math.max(0, joined.length - offset));
    joined.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(joined);
}

/**
 * GET one public https page: no IP literals, no hosts that resolve to private or loopback addresses (checked
 * on every redirect hop), at most 3 redirects, at most 300KB read. Never throws.
 */
export async function safeFetch(raw: string, fetcher: Fetcher = fetch, options: { lookup?: Lookup; signal?: AbortSignal; maxBytes?: number } = {}): Promise<PageResult> {
  const lookup = options.lookup ?? defaultLookup;
  const signal = options.signal ?? AbortSignal.timeout(8_000);
  let current: URL;
  try {
    current = new URL(raw);
  } catch {
    return { kind: "refused", reason: "not a link" };
  }
  try {
    for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop += 1) {
      const refusal = await hostRefusal(current, lookup);
      if (refusal) return { kind: "refused", reason: refusal };
      if (signal.aborted) return { kind: "failed", reason: "timed out", timeout: true };
      const response = await fetcher(current.toString(), { redirect: "manual", signal, headers: { "user-agent": "Mozilla/5.0 (compatible; NightWatchEvidenceCheck/1.0)", accept: "text/html,application/xhtml+xml" } });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) return { kind: "page", status: response.status, finalUrl: current.toString(), html: "" };
        current = new URL(location, current);
        continue;
      }
      const html = response.ok ? await readCapped(response, options.maxBytes ?? PAGE_MAX_BYTES) : "";
      if (!response.ok) await response.body?.cancel().catch(() => undefined);
      return { kind: "page", status: response.status, finalUrl: current.toString(), html };
    }
    return { kind: "failed", reason: "too many redirects", timeout: false };
  } catch (error) {
    const timeout = signal.aborted || (error instanceof Error && /abort|timeout/i.test(error.name + error.message));
    return { kind: "failed", reason: timeout ? "timed out" : error instanceof Error ? error.message.slice(0, 120) : "could not load", timeout };
  }
}

// ---------- grounding ----------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#8211": "-", "#8212": "-", "#8217": "'" };
const decode = (value: string) => value.replace(/&(#?\w+);/g, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
const squash = (value: string) => decode(value).toLowerCase().replace(/[^a-z0-9$%]+/g, " ").trim();

/** What the page says: visible text, and the full markup (titles and meta tags hold the job title on script-rendered ATS pages). */
function pageText(html: string) {
  const visible = squash(html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " "));
  return { visible, all: `${visible} ${squash(html)}` };
}

const EXPIRED = /no longer (accepting|available)|position (has been )?filled|job (has )?expired/i;
const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "their", "they", "have", "has", "was", "were", "into", "about", "company", "its", "our", "new"]);

/** Every word of a short claim (a title or system name) appears; most significant words of a longer fact do. */
function mentions(haystack: string, claim: string, long: boolean): boolean {
  const needle = squash(claim);
  if (!needle) return false;
  if (!long) return ` ${haystack} `.includes(` ${needle} `);
  const words = [...new Set(needle.split(" ").filter((word) => (word.length >= 4 || /\d/.test(word)) && !STOP.has(word)))];
  if (!words.length) return false;
  const padded = ` ${haystack} `;
  const hits = words.filter((word) => padded.includes(` ${word} `) || padded.includes(` ${word}s `)).length;
  return hits / words.length >= 0.6;
}

const UNIT_DAYS = { minute: 0, hour: 0, day: 1, week: 7, month: 30, year: 365 };

/** "2025-03-04", "March 4, 2025", or "3 days ago", as YYYY-MM-DD; null when it cannot be read. */
export function pageAgeDate(pageAge: string | null | undefined, now: Date = new Date()): string | null {
  if (!pageAge) return null;
  const value = pageAge.trim();
  const relative = value.match(/^(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago$/i);
  if (relative) {
    const days = UNIT_DAYS[relative[2].toLowerCase() as keyof typeof UNIT_DAYS] * Number(relative[1]);
    return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return Number.isNaN(Date.parse(`${value.slice(0, 10)}T00:00:00Z`)) ? null : value.slice(0, 10);
  // "March 4, 2025" parses as local midnight; read it back in local time so the day does not shift.
  const time = Date.parse(value);
  if (Number.isNaN(time)) return null;
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

type Claim = { label: string; url: string; text: string; long: boolean; numbers?: number[]; job?: boolean };
type Verdict = { grounding: Grounding; reason?: string };

export type GroundingContext = {
  seen: Iterable<SeenSource | string>;
  domain: string;
  /** The ranking page the company was sourced from; counts as seen. */
  sourceUrl?: string | null;
  fetcher?: Fetcher;
  lookup?: Lookup;
  /** One ceiling for every page check of this company. */
  deadlineMs?: number;
  now?: Date;
};

export type GroundingCounts = Record<Grounding, number>;
export type GroundedEvidence = { evidence: AiFitEvidence; limitations: string[]; counts: GroundingCounts };

function judge(page: PageResult, claim: Claim, cited: string, domain: string): Verdict {
  if (page.kind === "refused") return { grounding: "dropped", reason: page.reason };
  if (page.kind === "failed") return { grounding: "unverified", reason: page.reason };
  if ([401, 403, 429].includes(page.status) || page.status >= 500) return { grounding: "unverified", reason: `the page answered ${page.status}` };
  if (page.status === 404 || page.status === 410) return { grounding: "dropped", reason: "the page does not exist" };
  if (page.status >= 300) return { grounding: "unverified", reason: `the page answered ${page.status}` };
  const finalHost = hostOf(page.finalUrl);
  if (finalHost !== hostOf(cited) && !onDomain(page.finalUrl, domain) && !isJobBoardUrl(page.finalUrl)) return { grounding: "dropped", reason: `the link redirects to ${finalHost}` };
  const text = pageText(page.html);
  if (claim.job && EXPIRED.test(text.visible)) return { grounding: "dropped", reason: "the posting is closed" };
  const found = claim.numbers?.length
    ? claim.numbers.some((value) => ` ${text.visible} `.includes(` ${value} `) || ` ${text.visible} `.includes(` ${value.toLocaleString("en-US").replace(/,/g, " ")} `))
    : mentions(text.all, claim.text, claim.long);
  if (found) return { grounding: "confirmed" };
  if (text.visible.length < 200) return { grounding: "unverified", reason: "the page needs a browser to render" };
  return { grounding: "dropped", reason: "the page does not say this" };
}

/**
 * Mark each evidence item seen, confirmed, unverified or dropped. Seen items with no date take the search
 * result's page_age. Unseen items get one page check each (one fetch per distinct URL), all in parallel
 * under a single deadline; anything still waiting at the deadline is unverified.
 */
export async function groundEvidence(evidence: AiFitEvidence, context: GroundingContext): Promise<GroundedEvidence> {
  const now = context.now ?? new Date();
  const seen = new Map<string, SeenSource>();
  for (const item of context.seen) {
    const source = typeof item === "string" ? { url: item, title: null, page_age: null } : item;
    const key = normalizeUrl(source.url);
    if (!seen.has(key) || (!seen.get(key)?.page_age && source.page_age)) seen.set(key, source);
  }
  if (context.sourceUrl) {
    const key = normalizeUrl(context.sourceUrl);
    if (!seen.has(key)) seen.set(key, { url: context.sourceUrl, title: null, page_age: null });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("evidence check deadline")), context.deadlineMs ?? 8_000);
  const fetcher = context.fetcher ?? fetch;
  const pages = new Map<string, Promise<PageResult>>();
  const deadline = new Promise<PageResult>((resolve) => controller.signal.addEventListener("abort", () => resolve({ kind: "failed", reason: "timed out", timeout: true }), { once: true }));
  const pageFor = (url: string) => {
    const key = normalizeUrl(url);
    let page = pages.get(key);
    if (!page) {
      page = Promise.race([safeFetch(url, fetcher, { lookup: context.lookup, signal: controller.signal }), deadline]);
      pages.set(key, page);
    }
    return page;
  };

  const limitations: string[] = [];
  const counts: GroundingCounts = { seen: 0, confirmed: 0, unverified: 0, dropped: 0 };
  const check = async (claim: Claim): Promise<{ grounding: Grounding; pageAge: string | null }> => {
    const match = seen.get(normalizeUrl(claim.url));
    let verdict: Verdict;
    if (match) verdict = { grounding: "seen" };
    else verdict = judge(await pageFor(claim.url), claim, claim.url, context.domain);
    counts[verdict.grounding] += 1;
    if (verdict.grounding === "dropped") limitations.push(`Not counted: ${claim.label} (${verdict.reason}; ${claim.url}).`);
    if (verdict.grounding === "unverified") limitations.push(`Not counted, could not confirm: ${claim.label} (${verdict.reason}; ${claim.url}).`);
    return { grounding: verdict.grounding, pageAge: pageAgeDate(match?.page_age, now) };
  };

  try {
    const [hiring, change, techOpenness, systems, scale] = await Promise.all([
      Promise.all(evidence.hiring.map(async (item) => {
        const result = await check({ label: `hiring ${item.title}`, url: item.url, text: item.title, long: false, job: true });
        return { ...item, postedDate: item.postedDate ?? result.pageAge, grounding: result.grounding };
      })),
      Promise.all(evidence.change.map(async (item) => {
        const result = await check({ label: `${item.kind}: ${item.fact}`, url: item.url, text: item.fact, long: true });
        return { ...item, date: item.date ?? result.pageAge, grounding: result.grounding };
      })),
      Promise.all(evidence.techOpenness.map(async (item) => {
        const result = await check({ label: item.fact, url: item.url, text: item.fact, long: true });
        return { ...item, date: item.date ?? result.pageAge, grounding: result.grounding };
      })),
      Promise.all(evidence.systems.map(async (item) => ({ ...item, grounding: (await check({ label: `system ${item.name}`, url: item.url, text: item.name, long: false })).grounding }))),
      (async () => {
        const scale = evidence.scale;
        if (!scale?.url) return scale;
        const numbers = [scale.locations, scale.fieldWorkforce].filter((value): value is number => typeof value === "number" && value > 0);
        const volume = scale.highVolume?.match(/\d[\d,]*/)?.[0];
        if (volume) numbers.push(Number(volume.replace(/,/g, "")));
        const label = [scale.locations ? `${scale.locations} locations` : "", scale.fieldWorkforce ? `${scale.fieldWorkforce} field staff` : "", scale.highVolume ?? ""].filter(Boolean).join(", ") || "scale";
        const result = await check({ label, url: scale.url, text: label, long: true, numbers: numbers.length ? numbers : undefined });
        return { ...scale, grounding: result.grounding };
      })(),
    ]);
    return { evidence: { ...evidence, hiring, change, techOpenness, systems, scale }, limitations, counts };
  } finally {
    clearTimeout(timer);
  }
}
