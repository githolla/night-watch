/**
 * Applicant-tracking-system adapters. Each takes a board reference found on
 * the company's careers page and returns normalized postings from the
 * board's public JSON (or, for two HTML-only systems, a tolerant regex read).
 * Nothing here calls a model.
 */

export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "smartrecruiters"
  | "workable"
  | "bamboohr"
  | "workday"
  | "recruitee"
  | "breezy"
  | "icims"
  | "jobvite"
  | "ukg"
  | "oracle"
  | "rippling"
  | "jazzhr"
  | "teamtailor";

export type PostingSource = "careers" | "sitemap" | "jsonld" | "web_search";

export type Posting = {
  externalId: string | null;
  title: string;
  url: string;
  location: string | null;
  department: string | null;
  postedAt: string | null;
  source?: PostingSource;
  salaryMax?: number | null;
  description?: string | null;
  raw?: unknown;
};

export type AtsRef = { provider: AtsProvider; ref: string };

export type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const UA = "Mozilla/5.0 (compatible; NightWatch/1.0; +https://nine-67.com)";

export async function fetchText(fetcher: Fetcher, url: string, init?: RequestInit) {
  const response = await fetcher(url, { ...init, headers: { "user-agent": UA, accept: "application/json, text/html;q=0.9, */*;q=0.8", ...(init?.headers ?? {}) }, signal: init?.signal ?? AbortSignal.timeout(10_000), redirect: "follow" });
  return { ok: response.ok, status: response.status, body: response.ok ? await response.text() : "" };
}

function parseJson<T>(body: string): T | null {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

function isoDate(value: unknown): string | null {
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000).toISOString().slice(0, 10);
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString().slice(0, 10);
}

/** "Posted 3 Days Ago", "Posted Today", "Posted 30+ Days Ago" (Workday). */
export function relativePostedDate(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase();
  const days = /(\d+)\+?\s*day/.exec(lower)?.[1];
  let offset: number | null = null;
  if (/today/.test(lower)) offset = 0;
  else if (/yesterday/.test(lower)) offset = 1;
  else if (days) offset = Number(days);
  if (offset === null) return null;
  return new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
}

function decode(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Recognize a board reference anywhere in a careers page (or in the careers URL itself). */
export function detectAts(html: string, pageUrl: string): AtsRef | null {
  const haystack = `${pageUrl}\n${html}`;
  const patterns: Array<[AtsProvider, RegExp, (m: RegExpExecArray) => string]> = [
    ["greenhouse", /greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([\w-]+)/i, (m) => m[1]],
    ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([\w-]+)/i, (m) => m[1]],
    ["greenhouse", /(?:boards|job-boards)\.greenhouse\.io\/(?!embed\b)([\w-]+)/i, (m) => m[1]],
    ["lever", /jobs\.lever\.co\/([\w-]+)/i, (m) => m[1]],
    ["ashby", /jobs\.ashbyhq\.com\/([\w-]+)/i, (m) => m[1]],
    ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([\w-]+)/i, (m) => m[1]],
    ["workable", /apply\.workable\.com\/([\w-]+)/i, (m) => m[1]],
    ["bamboohr", /([\w-]+)\.bamboohr\.com\/(?:careers|jobs)/i, (m) => m[1]],
    ["workday", /https?:\/\/([\w-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)/i, (m) => `${m[1]}|${m[2]}|${m[3]}`],
    ["recruitee", /([\w-]+)\.recruitee\.com/i, (m) => m[1]],
    ["breezy", /([\w-]+)\.breezy\.hr/i, (m) => m[1]],
    ["icims", /(careers-[\w-]+)\.icims\.com/i, (m) => m[1]],
    ["jobvite", /jobs\.jobvite\.com\/([\w-]+)/i, (m) => m[1]],
    ["ukg", /(recruiting2?\.ultipro\.com)\/([\w-]+)\/JobBoard\/([\w-]+)/i, (m) => `${m[1]}|${m[2]}|${m[3]}`],
    ["oracle", /https?:\/\/([\w.-]+)\/hcmUI\/CandidateExperience\/[a-z-]+\/sites\/([\w-]+)/i, (m) => `${m[1]}|${m[2]}`],
    ["rippling", /ats\.rippling\.com\/([\w-]+)/i, (m) => m[1]],
    ["jazzhr", /([\w-]+)\.applytojob\.com/i, (m) => m[1]],
    ["teamtailor", /([\w-]+)\.teamtailor\.com/i, (m) => m[1]],
  ];
  for (const [provider, pattern, ref] of patterns) {
    const match = pattern.exec(haystack);
    if (match) {
      const value = ref(match);
      if (/^(www|jobs|careers|apply|boards|job-boards|static|assets|cdn|embed|api|v1)$/i.test(value)) continue;
      return { provider, ref: value };
    }
  }
  return null;
}

type GreenhouseJob = { id: number; title: string; absolute_url: string; updated_at?: string; first_published?: string; location?: { name?: string }; departments?: Array<{ name?: string }> };
type LeverJob = { id: string; text: string; hostedUrl: string; createdAt?: number; categories?: { department?: string; location?: string; team?: string } };
type AshbyJob = { id: string; title: string; jobUrl: string; publishedAt?: string; department?: string; location?: string };
type SmartRecruitersJob = { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string }; department?: { label?: string }; ref?: string };
type WorkableJob = { title: string; url?: string; shortcode?: string; created_at?: string; published_on?: string; department?: string; city?: string; country?: string };
type BambooJob = { id: number | string; jobOpeningName: string; departmentLabel?: string; location?: { city?: string; state?: string }; datePosted?: string };
type WorkdayJob = { title: string; externalPath: string; locationsText?: string; postedOn?: string };
type RecruiteeJob = { id?: number; title: string; careers_url: string; department?: string; created_at?: string; location?: string };
type BreezyJob = { id?: string; name: string; url: string; department?: string; published_date?: string; location?: { name?: string } };
type UkgJob = { Id: string; Title: string; PostedDate?: string; Locations?: Array<{ LocalizedName?: string }> };
type OracleJob = { Id: string; Title: string; PostedDate?: string; PrimaryLocation?: string };
type RipplingJob = { uuid?: string; name: string; url: string; department?: { name?: string } | string; workLocation?: { label?: string } | string; createdAt?: string };

export async function fetchPostings(fetcher: Fetcher, ats: AtsRef, now = new Date()): Promise<Posting[]> {
  switch (ats.provider) {
    case "greenhouse": {
      const { ok, body } = await fetchText(fetcher, `https://boards-api.greenhouse.io/v1/boards/${ats.ref}/jobs`);
      const json = ok ? parseJson<{ jobs?: GreenhouseJob[] }>(body) : null;
      return (json?.jobs ?? []).map((job) => ({ externalId: String(job.id), title: job.title, url: job.absolute_url, location: job.location?.name ?? null, department: job.departments?.[0]?.name ?? null, postedAt: isoDate(job.first_published ?? job.updated_at), raw: job }));
    }
    case "lever": {
      const { ok, body } = await fetchText(fetcher, `https://api.lever.co/v0/postings/${ats.ref}?mode=json`);
      const json = ok ? parseJson<LeverJob[]>(body) : null;
      return (Array.isArray(json) ? json : []).map((job) => ({ externalId: job.id, title: job.text, url: job.hostedUrl, location: job.categories?.location ?? null, department: job.categories?.department ?? job.categories?.team ?? null, postedAt: isoDate(job.createdAt), raw: job }));
    }
    case "ashby": {
      const { ok, body } = await fetchText(fetcher, `https://api.ashbyhq.com/posting-api/job-board/${ats.ref}`);
      const json = ok ? parseJson<{ jobs?: AshbyJob[] }>(body) : null;
      return (json?.jobs ?? []).map((job) => ({ externalId: job.id, title: job.title, url: job.jobUrl, location: job.location ?? null, department: job.department ?? null, postedAt: isoDate(job.publishedAt), raw: job }));
    }
    case "smartrecruiters": {
      const postings: Posting[] = [];
      for (let offset = 0; offset < 500; offset += 100) {
        const { ok, body } = await fetchText(fetcher, `https://api.smartrecruiters.com/v1/companies/${ats.ref}/postings?limit=100&offset=${offset}`);
        const json = ok ? parseJson<{ content?: SmartRecruitersJob[]; totalFound?: number }>(body) : null;
        const page = json?.content ?? [];
        postings.push(...page.map((job) => ({ externalId: job.id, title: job.name, url: `https://jobs.smartrecruiters.com/${ats.ref}/${job.id}`, location: [job.location?.city, job.location?.region].filter(Boolean).join(", ") || null, department: job.department?.label ?? null, postedAt: isoDate(job.releasedDate), raw: job })));
        if (page.length < 100) break;
      }
      return postings;
    }
    case "workable": {
      const { ok, body } = await fetchText(fetcher, `https://www.workable.com/api/accounts/${ats.ref}?details=false`);
      const json = ok ? parseJson<{ jobs?: WorkableJob[] }>(body) : null;
      return (json?.jobs ?? []).map((job) => ({ externalId: job.shortcode ?? null, title: job.title, url: job.url ?? `https://apply.workable.com/${ats.ref}/j/${job.shortcode ?? ""}`, location: [job.city, job.country].filter(Boolean).join(", ") || null, department: job.department ?? null, postedAt: isoDate(job.published_on ?? job.created_at), raw: job }));
    }
    case "bamboohr": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.bamboohr.com/careers/list`);
      const json = ok ? parseJson<{ result?: BambooJob[] }>(body) : null;
      return (json?.result ?? []).map((job) => ({ externalId: String(job.id), title: job.jobOpeningName, url: `https://${ats.ref}.bamboohr.com/careers/${job.id}`, location: [job.location?.city, job.location?.state].filter(Boolean).join(", ") || null, department: job.departmentLabel ?? null, postedAt: isoDate(job.datePosted), raw: job }));
    }
    case "workday": {
      const [tenant, host, site] = ats.ref.split("|");
      const base = `https://${tenant}.${host}.myworkdayjobs.com`;
      const postings: Posting[] = [];
      for (let offset = 0; offset < 400; offset += 20) {
        const { ok, body } = await fetchText(fetcher, `${base}/wday/cxs/${tenant}/${site}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ appliedFacets: {}, limit: 20, offset, searchText: "" }) });
        const json = ok ? parseJson<{ jobPostings?: WorkdayJob[]; total?: number }>(body) : null;
        const page = json?.jobPostings ?? [];
        postings.push(...page.map((job) => ({ externalId: job.externalPath, title: job.title, url: `${base}/${site}${job.externalPath}`, location: job.locationsText ?? null, department: null, postedAt: job.postedOn ? relativePostedDate(job.postedOn, now) : null, raw: job })));
        if (page.length < 20 || (json?.total !== undefined && offset + 20 >= json.total)) break;
      }
      return postings;
    }
    case "recruitee": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.recruitee.com/api/offers/`);
      const json = ok ? parseJson<{ offers?: RecruiteeJob[] }>(body) : null;
      return (json?.offers ?? []).map((job) => ({ externalId: job.id === undefined ? null : String(job.id), title: job.title, url: job.careers_url, location: job.location ?? null, department: job.department ?? null, postedAt: isoDate(job.created_at), raw: job }));
    }
    case "breezy": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.breezy.hr/json`);
      const json = ok ? parseJson<BreezyJob[]>(body) : null;
      return (Array.isArray(json) ? json : []).map((job) => ({ externalId: job.id ?? null, title: job.name, url: job.url, location: job.location?.name ?? null, department: job.department ?? null, postedAt: isoDate(job.published_date), raw: job }));
    }
    case "icims": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.icims.com/jobs/search?ss=1&in_iframe=1`);
      if (!ok) return [];
      return [...body.matchAll(/href="(https?:\/\/[^"]+\/jobs\/(\d+)\/[^"]*)"[^>]*>\s*(?:<h3[^>]*>)?([^<]{3,120})/gi)].map((m) => ({ externalId: m[2], title: decode(m[3]), url: m[1].split("?")[0], location: null, department: null, postedAt: null }));
    }
    case "ukg": {
      const [host, org, board] = ats.ref.split("|");
      const postings: Posting[] = [];
      for (let skip = 0; skip < 400; skip += 100) {
        const { ok, body } = await fetchText(fetcher, `https://${host}/${org}/JobBoard/${board}/JobBoardView/LoadSearchResults`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ opportunitySearch: { Top: 100, Skip: skip, QueryString: "", OrderBy: [{ Value: "postedDateDesc", PropertyName: "PostedDate", Ascending: false }], Filters: [] }, matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] } }),
        });
        const json = ok ? parseJson<{ opportunities?: UkgJob[]; totalCount?: number }>(body) : null;
        const page = json?.opportunities ?? [];
        postings.push(...page.map((job) => ({ externalId: job.Id, title: job.Title, url: `https://${host}/${org}/JobBoard/${board}/OpportunityDetail?opportunityId=${job.Id}`, location: job.Locations?.[0]?.LocalizedName ?? null, department: null, postedAt: isoDate(job.PostedDate), raw: job })));
        if (page.length < 100) break;
      }
      return postings;
    }
    case "oracle": {
      const [host, site] = ats.ref.split("|");
      const postings: Posting[] = [];
      for (let offset = 0; offset < 600; offset += 200) {
        const { ok, body } = await fetchText(fetcher, `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&finder=findReqs;siteNumber=${site},limit=200,offset=${offset}`);
        const json = ok ? parseJson<{ items?: Array<{ requisitionList?: OracleJob[]; TotalJobsCount?: number }> }>(body) : null;
        const page = json?.items?.[0]?.requisitionList ?? [];
        postings.push(...page.map((job) => ({ externalId: job.Id, title: job.Title, url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${job.Id}`, location: job.PrimaryLocation ?? null, department: null, postedAt: isoDate(job.PostedDate), raw: job })));
        if (page.length < 200) break;
      }
      return postings;
    }
    case "rippling": {
      const { ok, body } = await fetchText(fetcher, `https://api.rippling.com/platform/api/ats/v1/board/${ats.ref}/jobs`);
      const json = ok ? parseJson<RipplingJob[]>(body) : null;
      return (Array.isArray(json) ? json : []).map((job) => ({ externalId: job.uuid ?? null, title: job.name, url: job.url, location: typeof job.workLocation === "string" ? job.workLocation : job.workLocation?.label ?? null, department: typeof job.department === "string" ? job.department : job.department?.name ?? null, postedAt: isoDate(job.createdAt), raw: job }));
    }
    case "jazzhr": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.applytojob.com/apply/`);
      if (!ok) return [];
      return [...body.matchAll(/href="(https?:\/\/[\w-]+\.applytojob\.com\/apply\/([\w-]+)[^"]*)"[^>]*>([^<]{3,120})</gi)].map((m) => ({ externalId: m[2], title: decode(m[3]), url: m[1], location: null, department: null, postedAt: null }));
    }
    case "teamtailor": {
      const { ok, body } = await fetchText(fetcher, `https://${ats.ref}.teamtailor.com/jobs`);
      if (!ok) return [];
      return [...body.matchAll(/href="(https?:\/\/[\w-]+\.teamtailor\.com\/jobs\/(\d+)[^"]*)"[^>]*>[\s\S]*?<span[^>]*>([^<]{3,120})</gi)].map((m) => ({ externalId: m[2], title: decode(m[3]), url: m[1], location: null, department: null, postedAt: null }));
    }
    case "jobvite": {
      const { ok, body } = await fetchText(fetcher, `https://jobs.jobvite.com/${ats.ref}/jobs`);
      if (!ok) return [];
      return [...body.matchAll(/href="(\/[\w-]+\/job\/([\w-]+))"[^>]*>([^<]{3,120})</gi)].map((m) => ({ externalId: m[2], title: decode(m[3]), url: `https://jobs.jobvite.com${m[1]}`, location: null, department: null, postedAt: null }));
    }
  }
}

/**
 * Last resort for a careers page with no recognizable board: anchors whose
 * href looks like a job link and whose text looks like a title. A page that
 * renders its listings with JavaScript yields nothing here, and that is
 * reported honestly as "careers page found, listings not readable".
 */
export function postingsFromHtml(html: string, pageUrl: string): Posting[] {
  const seen = new Set<string>();
  const postings: Posting[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const text = decode(match[2]);
    if (!/\/(job|jobs|career|careers|position|positions|opening|openings|opportunit|vacanc|requisition|posting)s?\/[^/]+/i.test(href) && !/[?&](job|jobid|req|requisition|gh_jid|posting)=/i.test(href)) continue;
    if (text.length < 4 || text.length > 100 || /^(apply|view|read more|learn more|see all|all jobs|careers?|search|next|previous|back|home)$/i.test(text)) continue;
    let url: string;
    try {
      url = new URL(href, pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    postings.push({ externalId: null, title: text, url, location: null, department: null, postedAt: null });
  }
  return postings;
}

/** Common careers paths to try when the homepage gives no link. */
export const CAREERS_PATHS = ["/careers", "/jobs", "/careers/", "/join-us", "/join", "/about/careers", "/company/careers", "/about-us/careers", "/work-with-us", "/employment", "/opportunities", "/careers/openings", "/careers/jobs", "/career"];

/** A careers link on the homepage, if any. */
export function careersLinkFromHomepage(html: string, homepageUrl: string): string | null {
  for (const match of html.matchAll(/<a\b[^>]*href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = match[1];
    const text = decode(match[2]).toLowerCase();
    if (/career|jobs|join (us|our team)|work (with|for) us|employment|open (roles|positions)/i.test(text) || /\/(careers?|jobs|join-us|employment)\b/i.test(href)) {
      try {
        return new URL(href, homepageUrl).toString();
      } catch {
        continue;
      }
    }
  }
  return null;
}
