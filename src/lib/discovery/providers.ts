import { z } from "zod";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { safeFetch, type Fetcher, type Lookup } from "../evidence-grounding.ts";
import { classifyTitle, operatingNeedFor } from "../job-sweep/classify.ts";
import { itemSchema, type DiscoveryItem, type SourceConfig } from "./domain.ts";

class SourceReadError extends Error {}

export type Coverage = { source_id: string; state: "complete" | "partial" | "skipped" | "failed"; found: number; detail: string };
export type Collection = { items: DiscoveryItem[]; coverage: Coverage };
export function cleanText(raw: string) { return raw.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
function date(raw: unknown) {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const time = typeof raw === "number" ? raw : Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : typeof record(value)["#text"] === "string" ? String(record(value)["#text"]) : ""; }
function allowedUrl(raw: string) { try { const url = new URL(raw); return url.protocol === "https:" && !/(^|\.)(reddit\.com|redd\.it)$/.test(url.hostname) && !url.username && !url.password; } catch { return false; } }
export function feedItems(xml: string, source: SourceConfig, now: number): DiscoveryItem[] {
  if (!source.permission_reference.trim()) throw new Error("This feed has no recorded permission for business research.");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Malformed or unsafe XML feed.");
  const parsed: unknown = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(xml);
  const root = record(parsed);
  const entries = list(record(record(root.rss).channel).item).concat(list(record(root.feed).entry));
  return entries.slice(0, 100).flatMap((entry) => {
    const row = record(entry);
    const link = typeof row.link === "string" ? row.link : text(list(row.link).map(record).find((link) => !link["@_rel"] || link["@_rel"] === "alternate")?.["@_href"]);
    if (!allowedUrl(link)) return [];
    const title = cleanText(text(row.title)); if (!title) return [];
    const content = cleanText(text(row.description ?? row.summary ?? row["content:encoded"] ?? row.content));
    return [itemSchema.parse({ provider: "feed", source_id: source.id, external_id: text(row.guid ?? row.id) || link, url: link, title: title.slice(0, 1000), text: content.slice(0, 20000), published_at: date(row.pubDate ?? row.published ?? row.updated), observed_at: new Date(now).toISOString(), company: source.company || null, domain: source.domain || null, kind: "company_change", partial: content.length > 20000, deadline: null, active: true, permission_reference: source.permission_reference })];
  });
}
export class DiscoveryCollector {
  requests = 0;
  private signal: AbortSignal;
  private fetcher: Fetcher;
  private lookup: Lookup | undefined;
  private env: Record<string, string | undefined>;
  constructor(signal: AbortSignal, options: { fetcher?: Fetcher; lookup?: Lookup; env?: Record<string, string | undefined> } = {}) { this.signal = signal; this.fetcher = options.fetcher ?? fetch; this.lookup = options.lookup; this.env = options.env ?? process.env; }
  private async get(url: string, sec = false) {
    if (this.requests >= 80) throw new SourceReadError("Read allowance reached.");
    if (this.signal.aborted) throw new SourceReadError("Discovery deadline reached.");
    this.requests++;
    const fetcher: Fetcher = (raw, init) => this.fetcher(raw, { ...init, headers: { ...init?.headers, accept: "application/json,application/rss+xml,application/atom+xml,text/xml;q=0.9,*/*;q=0.5", "user-agent": sec ? this.env.SEC_USER_AGENT! : "NightWatch/1.0 (+https://nine-67.com)" } });
    const result = await safeFetch(url, fetcher, { lookup: this.lookup, signal: AbortSignal.any([this.signal, AbortSignal.timeout(new URL(url).hostname === "api.gdeltproject.org" ? 25000 : 10000)]), maxBytes: 1500000 });
    if (result.kind !== "page") throw new SourceReadError(result.kind === "failed" && result.timeout ? "Public source timed out." : "Public source unavailable or refused by the URL guard.");
    if (result.status !== 200) throw new SourceReadError(`Public source returned HTTP ${result.status}.`);
    if (result.html.length >= 1490000) throw new SourceReadError("Source exceeds the response-size limit; coverage is incomplete.");
    return result.html;
  }
  private async json(url: string, sec = false): Promise<unknown> { return JSON.parse(await this.get(url, sec)); }
  async collect(source: SourceConfig, limit: number, now: number, keywords: string[]): Promise<Collection> {
    const coverage: Coverage = { source_id: source.id, state: "complete", found: 0, detail: "" };
    const base: Pick<DiscoveryItem, "source_id" | "observed_at" | "company" | "domain" | "deadline" | "active" | "permission_reference"> = { source_id: source.id, observed_at: new Date(now).toISOString(), company: source.company || null, domain: source.domain || null, deadline: null, active: true, permission_reference: source.permission_reference };
    let items: DiscoveryItem[] = [];
    const make = (values: Omit<DiscoveryItem, keyof typeof base> & Partial<typeof base>) => itemSchema.parse({ ...base, ...values });
    try {
      if (source.provider === "feed" && (!source.permission_reference.trim() || !allowedUrl(source.value))) throw new Error("Feed permission or allowed URL missing.");
      if (source.provider === "greenhouse") {
        const json = z.object({ jobs: z.array(z.object({ id: z.number(), title: z.string(), absolute_url: z.string(), content: z.string().optional(), first_published: z.string().optional() })) }).parse(await this.json(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(source.value)}/jobs?content=true`));
        items = json.jobs.filter((job) => Boolean(classifyTitle(job.title))).flatMap((job) => {
          const family = classifyTitle(job.title); if (!family || !allowedUrl(job.absolute_url)) return [];
          return [make({ provider: "greenhouse", external_id: `${source.value}:${job.id}`, url: job.absolute_url, title: job.title.slice(0, 1000), text: cleanText(job.content ?? "").slice(0, 20000), published_at: date(job.first_published), kind: "hiring", partial: !job.content || (job.content?.length ?? 0) > 20000 })];
        });
      } else if (source.provider === "lever") {
        const json = z.array(z.object({ id: z.string(), text: z.string(), hostedUrl: z.string(), descriptionPlain: z.string().optional(), createdAt: z.number().optional(), lists: z.array(z.object({ text: z.string(), content: z.string() })).optional() })).parse(await this.json(`https://api.lever.co/v0/postings/${encodeURIComponent(source.value)}?mode=json`));
        items = json.filter((job) => Boolean(classifyTitle(job.text)) && allowedUrl(job.hostedUrl)).map((job) => make({ provider: "lever", external_id: `${source.value}:${job.id}`, url: job.hostedUrl, title: job.text.slice(0, 1000), text: cleanText(`${job.descriptionPlain ?? ""}\n${(job.lists ?? []).map((list) => `${list.text}: ${list.content}`).join("\n")}`).slice(0, 20000), published_at: date(job.createdAt), kind: "hiring", partial: !job.descriptionPlain || (job.descriptionPlain.length + (job.lists ?? []).reduce((sum, item) => sum + item.text.length + item.content.length, 0)) > 20000 }));
      } else if (source.provider === "gdelt") {
        const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
        for (const [key, value] of Object.entries({ query: source.value, mode: "artlist", format: "json", sort: "datedesc", timespan: "3d", maxrecords: String(Math.min(100, limit * 2)) })) url.searchParams.set(key, value);
        const json = z.object({ articles: z.array(z.object({ url: z.string(), title: z.string(), seendate: z.string().optional() })).default([]) }).parse(await this.json(url.toString()));
        items = json.articles.filter((article) => allowedUrl(article.url)).map((article) => make({ provider: "gdelt", external_id: article.url, url: article.url, title: article.title.slice(0, 1000), text: "GDELT discovery metadata only. Publisher article has not been retrieved or verified.", published_at: null, kind: "company_change", partial: true }));
        coverage.state = "partial"; coverage.detail = "Article titles only; publisher facts, identity and publication dates require human verification. GDELT seen dates are not publication dates.";
      } else if (source.provider === "hacker_news") {
        const ids = z.array(z.number()).parse(await this.json("https://hacker-news.firebaseio.com/v0/askstories.json"));
        const slice = ids.slice(0, Math.min(30, limit * 2));
        for (const id of slice) {
          const raw = await this.json(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          if (raw === null) continue;
          const post = z.object({ id: z.number(), title: z.string().optional(), text: z.string().optional(), time: z.number(), dead: z.boolean().optional(), deleted: z.boolean().optional(), kids: z.array(z.number()).optional() }).parse(raw);
          if (post.dead || post.deleted || post.time * 1000 < now - 72 * 3600000) continue;
          const body = cleanText(post.text ?? "");
          if (!keywords.some((keyword) => `${post.title} ${body}`.toLowerCase().includes(keyword.toLowerCase()))) continue;
          items.push(make({ provider: "hacker_news", external_id: String(post.id), url: `https://news.ycombinator.com/item?id=${post.id}`, title: (post.title ?? "Ask HN").slice(0, 1000), text: body.slice(0, 20000), published_at: new Date(post.time * 1000).toISOString(), kind: "discussion", partial: Boolean(post.kids?.length) || body.length > 20000 }));
        }
        coverage.state = "partial"; coverage.detail = `Examined ${slice.length} recent Ask HN posts. Comments are not collected; open the original conversation before responding.`;
      } else if (source.provider === "sam") {
        if (!this.env.SAM_API_KEY) return { items: [], coverage: { ...coverage, state: "skipped", detail: "Set SAM_API_KEY from a SAM.gov account to collect published buying requests." } };
        const format = (time: number) => { const d = new Date(time); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`; };
        const url = new URL("https://api.sam.gov/opportunities/v2/search");
        for (const [key, value] of Object.entries({ api_key: this.env.SAM_API_KEY, postedFrom: format(now - 7 * 86400000), postedTo: format(now), limit: String(limit), offset: "0", ...(source.value ? { ncode: source.value } : {}) })) url.searchParams.set(key, value);
        const json = z.object({ totalRecords: z.number(), opportunitiesData: z.array(z.object({ noticeId: z.string(), title: z.string(), uiLink: z.string().optional(), postedDate: z.string(), active: z.string(), type: z.string().optional(), fullParentPathName: z.string().optional(), responseDeadLine: z.string().nullable().optional(), reponseDeadLine: z.string().nullable().optional() })).default([]) }).parse(await this.json(url.toString()));
        items = json.opportunitiesData.filter((notice) => notice.active === "Yes" && /solicitation|sources sought/i.test(notice.type ?? "") && keywords.some((keyword) => notice.title.toLowerCase().includes(keyword.toLowerCase()))).map((notice) => make({ provider: "sam", external_id: notice.noticeId, url: `https://sam.gov/opp/${encodeURIComponent(notice.noticeId)}/view`, title: notice.title.slice(0, 1000), text: `${notice.type ?? "Published opportunity"}. Agency: ${notice.fullParentPathName ?? "not stated"}. Full scope, eligibility, purchasing requirements and response deadline must be checked on SAM.gov.`, published_at: date(notice.postedDate), kind: "buying_request", company: null, domain: null, partial: true, deadline: date(notice.responseDeadLine ?? notice.reponseDeadLine) }));
        if (json.totalRecords > limit) { coverage.state = "partial"; coverage.detail = `Only the first ${limit} notices were examined out of ${json.totalRecords}.`; }
      } else if (source.provider === "sec") {
        if (!this.env.SEC_USER_AGENT) return { items: [], coverage: { ...coverage, state: "skipped", detail: "Set SEC_USER_AGENT with application name and contact email for SEC fair access." } };
        const json = z.object({ filings: z.object({ recent: z.object({ accessionNumber: z.array(z.string()), filingDate: z.array(z.string()), form: z.array(z.string()), primaryDocument: z.array(z.string()) }) }) }).parse(await this.json(`https://data.sec.gov/submissions/CIK${source.value.padStart(10, "0")}.json`, true));
        const recent = json.filings.recent;
        items = recent.accessionNumber.flatMap((accession, index) => {
          const published = date(recent.filingDate[index]);
          if (!published || Date.parse(published) < now - 7 * 86400000 || !["8-K", "D", "D/A"].includes(recent.form[index])) return [];
          const document = recent.primaryDocument[index]; if (!document || !/^[\w.-]+$/.test(document) || !/^[\d-]+$/.test(accession)) return [];
          return [make({ provider: "sec", external_id: `${source.value}:${accession}`, url: `https://www.sec.gov/Archives/edgar/data/${Number(source.value)}/${accession.replaceAll("-", "")}/${document}`, title: `${source.company}: ${recent.form[index]} filed ${recent.filingDate[index]}`, text: "New filing metadata only. A filing does not by itself establish an acquisition, funding amount or need for automation. Read the document to determine the actual event.", published_at: published, kind: "filing", partial: true })];
        });
        coverage.state = "partial"; coverage.detail = "Filing metadata only; no funding or operational claim inferred from a form number.";
      } else if (source.provider === "feed") items = feedItems(await this.get(source.value), source, now);
      coverage.found = items.length;
      if (items.length > limit) { coverage.state = "partial"; coverage.detail += ` ${items.length - limit} items deferred by the source cap.`; }
      return { items: items.slice(0, limit), coverage };
    } catch (error) { return { items: [], coverage: { ...coverage, state: "failed", detail: `${error instanceof SourceReadError ? error.message : "Source response or configuration failed validation."} No fallback scraping attempted.` } }; }
  }
}
export function hiringHypothesis(item: DiscoveryItem) {
  const family = classifyTitle(item.title);
  return family ? operatingNeedFor([{ family, title: item.title }]) : null;
}
