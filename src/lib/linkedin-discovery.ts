import { searchProvider, webSearch, type SearchHit } from "./web-search.ts";

/**
 * People and posts on LinkedIn, found the only way that is allowed: from
 * public search results, by URL pattern, with no LinkedIn automation and no
 * model. A profile result reads "Name - Title - Company | LinkedIn"; a post
 * result reads "Name on LinkedIn: the first line of the post".
 */
export type FoundProfile = { name: string; title: string; company: string; url: string };
export type FoundPost = { author: string; excerpt: string; url: string; kind: "post" | "article" | "other"; platform: string; date: string | null };

const AI_WORDS = /\b(ai|a\.i\.|artificial intelligence|automation|automate|automating|llm|gpt|copilot|agentic|agents?|machine learning|efficien\w*|workflow|data pipeline|analytics)\b/i;

function decode(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, "\"").replace(/\s+/g, " ").trim();
}
function stripLinkedIn(title: string) {
  return decode(title).replace(/\s*[|\-–]\s*LinkedIn\s*$/i, "").trim();
}
function sameCompany(candidate: string, company: string) {
  const a = candidate.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = company.toLowerCase().replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|holdings)\b/g, "").replace(/[^a-z0-9]/g, "");
  return Boolean(a && b && (a.includes(b) || b.includes(a)));
}

/** A person from a profile result, only when the result says they are at this company. */
export function parseProfile(hit: SearchHit, company: string): FoundProfile | null {
  if (!/linkedin\.com\/in\//i.test(hit.url)) return null;
  const parts = stripLinkedIn(hit.title).split(/\s+[-–|]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts[0];
  if (!/^[A-Z][^\d@]{1,40}$/.test(name) || name.split(/\s+/).length < 2) return null;
  const rest = parts.slice(1);
  const companyIndex = rest.findIndex((part) => sameCompany(part, company));
  const snippetSays = sameCompany(hit.snippet, company) || new RegExp(`\\bat ${company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hit.snippet);
  if (companyIndex === -1 && !snippetSays) return null;
  const title = (companyIndex === -1 ? rest[0] : rest.filter((_, index) => index !== companyIndex)[0]) ?? "";
  if (!title || title.length > 90) return null;
  return { name, title, company, url: hit.url.split("?")[0] };
}

/** A post or article from a result, with the author from the title. */
export function parsePost(hit: SearchHit): FoundPost | null {
  const kind = /linkedin\.com\/posts\//i.test(hit.url) ? "post" : /linkedin\.com\/pulse\//i.test(hit.url) ? "article" : null;
  if (!kind) return null;
  const title = stripLinkedIn(hit.title);
  const on = title.match(/^(.+?) on LinkedIn:\s*(.*)$/i);
  const possessive = title.match(/^(.+?)['’]s Post$/i);
  const author = (on?.[1] ?? possessive?.[1] ?? "").trim();
  const text = decode([on?.[2] ?? "", hit.snippet].filter(Boolean).join(" ").trim());
  if (kind === "post" && !author) return null;
  if (text.length < 20) return null;
  const date = hit.date && /^\d{4}-\d{2}-\d{2}/.test(hit.date) ? hit.date.slice(0, 10) : null;
  return { author: author || "Unknown", excerpt: text.slice(0, 600), url: hit.url.split("?")[0], kind, platform: kind === "article" ? "linkedin article" : "linkedin", date };
}

/** A post elsewhere (X, Medium, Substack, YouTube, a podcast page) that talks about AI or automation. */
export function parseOther(hit: SearchHit): FoundPost | null {
  let hostName = "";
  try { hostName = new URL(hit.url).hostname.replace(/^www\./, ""); } catch { return null; }
  if (/linkedin\.com/i.test(hostName)) return null;
  const text = decode([hit.title, hit.snippet].filter(Boolean).join(" · "));
  if (text.length < 30 || !aboutAi(text)) return null;
  const platform = /x\.com|twitter\.com/.test(hostName) ? "x" : /medium\.com/.test(hostName) ? "medium" : /substack\.com/.test(hostName) ? "substack" : /youtube\.com|youtu\.be/.test(hostName) ? "youtube" : hostName;
  const author = (hit.title.match(/^([A-Z][a-zA-Z'’.-]+(?:\s[A-Z][a-zA-Z'’.-]+){1,2})\s+(?:on|\||-|–)/)?.[1] ?? "").trim();
  const date = hit.date && /^\d{4}-\d{2}-\d{2}/.test(hit.date) ? hit.date.slice(0, 10) : null;
  return { author: author || "Unknown", excerpt: text.slice(0, 600), url: hit.url.split("?")[0], kind: "other", platform, date };
}

export function aboutAi(text: string) {
  return AI_WORDS.test(text);
}

/**
 * Run the LinkedIn queries for one company. Profiles by the titles that
 * matter, then posts and articles that mention the company, then posts by
 * the people already known. Cheap, and free of any model.
 */
/** The departments where the buyers sit, one query each. */
const DEPARTMENTS = [
  '("Chief Operating Officer" OR COO OR "VP Operations" OR "Head of Operations" OR "Director of Operations")',
  '("Chief Information Officer" OR CIO OR "Chief Technology Officer" OR CTO OR "VP Engineering" OR "Director of IT")',
  '("Chief Data Officer" OR "VP Data" OR "Head of Data" OR "Director of Analytics" OR "Business Intelligence")',
  '("Chief Financial Officer" OR CFO OR "VP Finance" OR Controller OR "FP&A")',
  '("Chief Revenue Officer" OR CRO OR "Revenue Operations" OR "Sales Operations" OR "VP Sales")',
  '("Customer Success" OR "Customer Experience" OR "VP Customer" OR "Head of Support")',
  '("Transformation" OR "Automation" OR "Process Improvement" OR "Continuous Improvement" OR "Business Systems")',
  '("Chief of Staff" OR President OR "General Manager" OR "Managing Director" OR Partner)',
  '("Chief Executive Officer" OR CEO OR Founder OR Owner)',
];
const POST_ANGLES = [
  "",
  '(AI OR "artificial intelligence" OR automation OR "machine learning" OR agents)',
  '(data OR analytics OR ERP OR Salesforce OR NetSuite OR "systems")',
  '(hiring OR "join our team" OR "we are growing" OR "open role")',
  '(efficiency OR "manual" OR "process" OR "workflow" OR "scale")',
  '(excited OR announce OR launched OR acquired OR "new role")',
];

/**
 * Run the searches for one company: profiles by the titles that matter and
 * by department, posts and articles from several angles, posts by everyone
 * already on file, and what is said on X, Medium, Substack, YouTube and
 * podcasts. Cheap per query, and free of any model. `maxQueries` caps it.
 */
export async function discoverLinkedIn(company: string, titles: string[], knownNames: string[] = [], search: (query: string, count?: number) => Promise<SearchHit[]> = webSearch, maxQueries = 40): Promise<{ people: FoundProfile[]; posts: FoundPost[]; queries: number; provider: string | null }> {
  if (!searchProvider() && search === webSearch) return { people: [], posts: [], queries: 0, provider: null };
  const people = new Map<string, FoundProfile>();
  const posts = new Map<string, FoundPost>();
  const quoted = `"${company}"`;
  const titleChunks: string[][] = [];
  for (let index = 0; index < titles.length; index += 4) titleChunks.push(titles.slice(index, index + 4));
  const queries = [
    ...titleChunks.map((chunk) => `site:linkedin.com/in ${quoted} (${chunk.map((title) => `"${title}"`).join(" OR ")})`),
    ...DEPARTMENTS.map((department) => `site:linkedin.com/in ${quoted} ${department}`),
    ...POST_ANGLES.map((angle) => `site:linkedin.com/posts ${quoted} ${angle}`.trim()),
    `site:linkedin.com/pulse ${quoted}`,
    `site:linkedin.com/pulse ${quoted} (AI OR automation OR data)`,
    ...knownNames.slice(0, 15).map((name) => `site:linkedin.com/posts "${name}" ${quoted}`),
    `${quoted} (site:x.com OR site:twitter.com) (AI OR automation)`,
    `${quoted} (site:medium.com OR site:substack.com) (AI OR automation OR operations)`,
    `${quoted} (podcast OR webinar OR keynote OR "fireside") (AI OR automation OR operations)`,
    `${quoted} site:youtube.com (AI OR automation OR operations)`,
  ].slice(0, maxQueries);
  let ran = 0;
  for (const query of queries) {
    let hits: SearchHit[] = [];
    try { hits = await search(query, 10); ran += 1; } catch { continue; }
    for (const hit of hits) {
      const profile = parseProfile(hit, company);
      if (profile && !people.has(profile.url)) people.set(profile.url, profile);
      const post = parsePost(hit) ?? parseOther(hit);
      if (post && !posts.has(post.url)) posts.set(post.url, post);
    }
  }
  return { people: [...people.values()], posts: [...posts.values()], queries: ran, provider: searchProvider() ?? "custom" };
}
