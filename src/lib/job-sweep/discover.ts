/**
 * Second and third ways to find postings when no board is embedded:
 * JobPosting structured data (JSON-LD) on any page, and the site's sitemap,
 * which many script-rendered careers sites still publish in full.
 */
import { fetchText, type Fetcher, type Posting } from "./ats.ts";

type JsonLdNode = Record<string, unknown>;

function nodes(value: unknown): JsonLdNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const node = value as JsonLdNode;
  const out: JsonLdNode[] = [node];
  if (Array.isArray(node["@graph"])) out.push(...nodes(node["@graph"]));
  if (Array.isArray(node.itemListElement)) out.push(...nodes(node.itemListElement));
  if (node.item && typeof node.item === "object") out.push(...nodes(node.item));
  return out;
}

function typeOf(node: JsonLdNode) {
  const type = node["@type"];
  return Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
}

function salaryOf(node: JsonLdNode): number | null {
  const base = node.baseSalary as JsonLdNode | undefined;
  const value = base?.value;
  if (typeof value === "number") return value;
  if (value && typeof value === "object") {
    const spec = value as JsonLdNode;
    const max = Number(spec.maxValue ?? spec.value);
    return Number.isFinite(max) && max > 0 ? max : null;
  }
  return null;
}

export type JsonLdPosting = Posting & { salaryMax: number | null; description: string | null };

/** Every JobPosting described in JSON-LD on the page. */
export function jsonLdPostings(html: string, pageUrl: string): JsonLdPosting[] {
  const postings: JsonLdPosting[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[1].trim());
    } catch {
      continue;
    }
    for (const node of nodes(parsed)) {
      if (!typeOf(node).includes("JobPosting")) continue;
      const title = text(node.title ?? node.name);
      if (!title) continue;
      let url: string;
      try {
        url = new URL(String(node.url ?? node.sameAs ?? pageUrl), pageUrl).toString();
      } catch {
        url = pageUrl;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      const location = node.jobLocation as JsonLdNode | JsonLdNode[] | undefined;
      const address = (Array.isArray(location) ? location[0] : location)?.address as JsonLdNode | undefined;
      const posted = typeof node.datePosted === "string" ? node.datePosted.slice(0, 10) : null;
      postings.push({
        externalId: node.identifier && typeof node.identifier === "object" ? text((node.identifier as JsonLdNode).value) || null : typeof node.identifier === "string" ? node.identifier : null,
        title,
        url,
        location: address ? [text(address.addressLocality), text(address.addressRegion)].filter(Boolean).join(", ") || null : null,
        department: null,
        postedAt: posted && /^\d{4}-\d{2}-\d{2}$/.test(posted) ? posted : null,
        salaryMax: salaryOf(node),
        description: text(node.description).slice(0, 600) || null,
        raw: node,
      });
    }
  }
  return postings;
}

const JOB_KEYWORD = /^(?:job|jobs|career|careers|position|positions|opening|openings|opportunity|opportunities|vacancy|vacancies|requisition|requisitions|posting|postings|job-details?)$/i;
const NOISE_WORD = /^(?:job|jobs|en|us|gb|apply|details?|view|index)$/i;

function wordsOf(segment: string) {
  let slug: string;
  try {
    slug = decodeURIComponent(segment);
  } catch {
    slug = segment;
  }
  return slug
    .replace(/\.(html?|aspx|php)$/i, "")
    .replace(/[_+.]/g, "-")
    .split("-")
    .filter((word) => word && !/^\d+$/.test(word) && !/^[a-z]{0,2}\d{3,}$/i.test(word) && !/^[0-9a-f]{8,}$/i.test(word) && !NOISE_WORD.test(word));
}

/** "senior-data-analyst-r123456" → "Senior Data Analyst". Looks at up to three path segments after a job keyword and keeps the wordiest. */
export function titleFromSlug(url: string): string | null {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return null;
  }
  const segments = path.split("/").filter(Boolean);
  const keyword = segments.findIndex((segment) => JOB_KEYWORD.test(segment));
  if (keyword === -1) return null;
  const candidates = segments.slice(keyword + 1, keyword + 4).map(wordsOf).filter((words) => words.length >= 2 && words.join(" ").length <= 90);
  if (!candidates.length) return null;
  const best = candidates.sort((left, right) => right.length - left.length)[0];
  return best.map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

function locs(xml: string) {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((match) => match[1].trim());
}

/**
 * Job URLs from the site's sitemap(s). Follows child sitemaps whose name
 * mentions jobs or careers, and any child when the index is small.
 */
export async function sitemapPostings(fetcher: Fetcher, hosts: string[], limit = 300): Promise<Posting[]> {
  const found = new Map<string, Posting>();
  for (const host of hosts) {
    for (const path of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/jobs-sitemap.xml", "/sitemap/jobs.xml"]) {
      let page: { ok: boolean; body: string };
      try {
        page = await fetchText(fetcher, `https://${host}${path}`);
      } catch {
        continue;
      }
      if (!page.ok || !/<(urlset|sitemapindex)/i.test(page.body)) continue;
      const entries = locs(page.body);
      const children = /<sitemapindex/i.test(page.body)
        ? entries.filter((url) => /job|career|position|opening|vacanc/i.test(url) || entries.length <= 8).slice(0, 6)
        : [];
      const pages = children.length ? await Promise.all(children.map(async (child) => { try { return (await fetchText(fetcher, child)).body; } catch { return ""; } })) : [page.body];
      for (const body of pages) {
        for (const url of locs(body)) {
          if (found.size >= limit) break;
          if (found.has(url)) continue;
          const title = titleFromSlug(url);
          if (!title) continue;
          found.set(url, { externalId: null, title, url, location: null, department: null, postedAt: null });
        }
      }
      if (found.size) return [...found.values()];
    }
  }
  return [...found.values()];
}
