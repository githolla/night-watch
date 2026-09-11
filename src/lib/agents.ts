import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SimulationInput, SimulationResult } from "@/lib/message-simulation";
import { recordAnthropicUsage, type UsageRecorder } from "./anthropic-cost.ts";
import { parseModelJson } from "./model-output.ts";

export { parseModelJson } from "./model-output.ts";

/** Signals below this confidence are not stored. Shown on the run log as "found, below threshold". */
export const SCOUT_CONFIDENCE_FLOOR = 0.6;

/**
 * The scout answer shares max_tokens with the narration around up to
 * maxSearches searches, so it needs headroom; a truncated reply is detected
 * by stop_reason and reported as truncation, never as bad JSON.
 */
export const SCOUT_MAX_TOKENS = 8_000;

/**
 * A server-tool turn pauses with stop_reason=pause_turn after the API's own
 * search-loop limit. The turn is resumed by re-sending the conversation with
 * the assistant content appended; this caps how many times that happens.
 */
export const MAX_TURN_CONTINUATIONS = 5;

/** `YYYY-MM-DD`; an ISO datetime is trimmed to its date part first. */
const isoDate = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().slice(0, 10) : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a YYYY-MM-DD date")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "must be a real calendar date"),
);

const signal = z.object({
  type: z.enum(["job_post", "job_cluster", "exec_post", "new_leader", "funding", "event", "stack_change", "other"]),
  summary: z.string(),
  source_url: z.url({ protocol: /^https?$/ }),
  observed_at: isoDate,
  /** The specific work the company needs done that Nine-67 could build or run instead of a hire. The qualification gate. */
  operating_need: z.string().trim().min(1),
  evidence_kind: z.enum(["hiring", "asking_for_help", "ai_post", "new_mandate", "growth_event"]).optional(),
  people: z.array(z.object({ name: z.string(), title: z.string(), role_in_signal: z.string() })).default([]),
  post: z.object({
    text: z.string(), author_name: z.string(), author_title: z.string().default(""), published_at: z.string().nullable().default(null),
    reactions: z.number().int().nonnegative().nullable().default(null),
    comments: z.number().int().nonnegative().nullable().default(null),
    reposts: z.number().int().nonnegative().nullable().default(null),
    hashtags: z.array(z.string()).default([]), is_excerpt: z.boolean().default(false),
  }).optional(),
  source: z.object({
    headline: z.string().default(""), publisher: z.string().default(""), author_name: z.string().nullable().default(null),
    published_at: z.string().nullable().default(null), excerpt: z.string().default(""),
  }).optional(),
  job: z.object({
    title: z.string(), department: z.string(), days_open: z.number(), reposted: z.boolean(),
    salary_max: z.number(), tools_named: z.array(z.string()), responsibilities: z.array(z.string()),
  }).optional(),
  confidence: z.number().min(0).max(1),
});

export const scoutOutput = z.object({ signals: z.array(signal) });
export type ScoutSignal = z.infer<typeof signal>;

/** Job families where Nine-67 does the work instead of the company hiring for it. Mirrors docs/scoring.md. */
export const TARGET_JOB_FAMILIES = [
  "AI/ML", "automation", "data/analyst", "RevOps", "operations analyst", "volume-driven customer support", "BDR/SDR", "systems/integration", "CRM administration",
] as const;

/**
 * Deterministic evidence rules the model cannot talk its way around. An
 * executive's opinion piece never qualifies: an exec_post must carry the
 * actual post text from a person at the company, and a job signal must name
 * the role. Returns the reason a signal is dropped, or null when it stands.
 */
export function disqualifySignal(item: ScoutSignal): string | null {
  if (!item.operating_need.trim()) return "no operating need named";
  if (item.type === "exec_post") {
    if (!item.post?.text?.trim()) return "exec_post without the actual post text";
    if (!item.post.author_name?.trim() && !item.people.length) return "exec_post without a named author";
    if (/forbes\.com|inc\.com|entrepreneur\.com|hbr\.org|fastcompany\.com|medium\.com|substack\.com/i.test(item.source_url)) return "opinion piece, not an operator post";
  }
  if ((item.type === "job_post" || item.type === "job_cluster") && !item.job?.title?.trim()) return "job signal without a role title";
  return null;
}

const angle = z.object({
  brief: z.string(), why_now: z.string(),
  channel: z.enum(["linkedin_first", "email_first", "intro", "linkedin_only"]),
  linkedin_comment: z.string(), linkedin_note: z.string().max(200),
  email_subject: z.string(), email_body: z.string(),
});

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function researchModel() {
  return process.env.ANTHROPIC_RESEARCH_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
}

function writingModel() {
  return process.env.ANTHROPIC_WRITING_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
}

function utilityModel() {
  return process.env.ANTHROPIC_UTILITY_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
}

function text(blocks: Anthropic.Messages.ContentBlock[]) {
  return blocks.filter((block): block is Anthropic.Messages.TextBlock => block.type === "text").map((block) => block.text).join("\n");
}

function jsonFrom(response: Pick<Anthropic.Messages.Message, "content" | "stop_reason">) {
  return parseModelJson(response.content, response.stop_reason);
}

function webSearchTool(maxUses: number): Anthropic.Messages.ToolUnion {
  return { type: "web_search_20250305", name: "web_search", max_uses: maxUses };
}

/**
 * Run one request to completion. When the server-side search loop pauses the
 * turn, re-send the conversation with the assistant content appended so the
 * API resumes where it left off; usage is recorded for every round.
 */
async function completeTurn(
  params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages">,
  prompt: string,
  recordUsage?: UsageRecorder,
) {
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  let response = await client().messages.create({ ...params, messages });
  recordAnthropicUsage(response, params.model, recordUsage);
  for (let round = 0; round < MAX_TURN_CONTINUATIONS && response.stop_reason === "pause_turn"; round += 1) {
    messages.push({ role: "assistant", content: response.content });
    response = await client().messages.create({ ...params, messages });
    recordAnthropicUsage(response, params.model, recordUsage);
  }
  return response;
}

/** One model turn with web search that must answer in JSON. The analysis agents are built on this. */
export async function runSearchAgent(prompt: string, options: { model: string; maxSearches: number; maxTokens?: number }, recordUsage?: UsageRecorder): Promise<unknown> {
  const response = await completeTurn({ model: options.model, max_tokens: options.maxTokens ?? 8_000, tools: [webSearchTool(Math.max(1, Math.min(10, options.maxSearches)))] }, prompt, recordUsage);
  return jsonFrom(response);
}

/** One model turn with no tools that must answer in JSON. */
export async function runWritingAgent(prompt: string, options: { model: string; maxTokens?: number }, recordUsage?: UsageRecorder): Promise<unknown> {
  const response = await completeTurn({ model: options.model, max_tokens: options.maxTokens ?? 8_000 }, prompt, recordUsage);
  return jsonFrom(response);
}

export type ScoutResult = {
  /** Signals at or above the confidence floor, strongest first, capped to one. */
  signals: ScoutSignal[];
  /** Raw count the model returned before any filtering. */
  found: number;
  /** Count kept after the confidence floor. */
  kept: number;
  model: string;
  stopReason: string | null;
};

export async function scout(account: {
  name: string; domain: string; vertical?: string | null; employee_range?: string | null;
  careers_url?: string | null; news_query?: string | null;
  researchContext?: { aiSignal: string; sourceUrl: string; ceo: string; buyerTitles: string[]; revenueBand: string; subSegment: string };
}, recordUsage?: UsageRecorder, options: { maxSearches?: number } = {}): Promise<ScoutResult> {
  const context = account.researchContext;
  const model = researchModel();
  const maxSearches = Math.max(1, Math.min(10, Math.floor(options.maxSearches ?? Number(process.env.ANTHROPIC_MAX_SEARCHES_PER_COMPANY ?? 3))));
  const prompt = `Research ${account.name} (${account.domain}), a ${account.vertical ?? "target"} company with ${account.employee_range ?? "unknown"} employees.

Nine-67 builds and runs AI and automation for operating teams so a company does not have to hire for that work. You are looking for one thing: public evidence that ${account.name} has work of that kind it needs done right now. The context below is background, not a source: do not spend a search on the starting URL unless it is a careers page or a post by someone at the company. Spend searches on the company's careers page, job boards, and posts by its managers. Prioritize the last 30 days; if nothing qualifies in 30 days, use the strongest qualifying development from the last 180 days.

A development qualifies only if it shows a concrete operating need inside ${account.name}. Look for these, in this order:
1. hiring (type job_post or job_cluster): open roles on ${account.careers_url ?? "the careers page"} or job boards in these families: ${TARGET_JOB_FAMILIES.join(", ")}. Clusters of related roles, reposted roles, and roles open 30+ days are the strongest. Capture the exact title, department, days open, whether reposted, salary maximum if shown, tools named, and the responsibilities as written.
2. asking_for_help (type exec_post): a manager, director or VP at ${account.name} publicly asking for recommendations, vendors, tools, or describing a bottleneck in their own team they are trying to fix, in a LinkedIn post, community thread, or conference Q&A. The post must be about their own team's work. Quote the actual visible post text and name the author.
3. ai_post (type exec_post): anyone who works at ${account.name} posting publicly, in their own words, about AI, automation, agents or efficiency in their own work or team: what they are trying, what is hard, what they want. LinkedIn posts, X posts, personal blogs, conference talks. Quote the actual visible post text and name the author and their title. A press release, an interview in a publication, or an opinion column is not a post.
4. new_mandate (type new_leader): a newly appointed leader whose stated mandate is operations, data, automation, AI, RevOps or support at ${account.name}.
5. growth_event (type funding): funding, an acquisition, or an expansion that creates integration, scaling or back-office work at ${account.name}.

Do not return: opinion pieces, op-eds, columns in Forbes or trade press, interviews or podcasts about industry trends, thought leadership about AI, product launches, press releases, awards, or anything about the market rather than the company's own operations. A CEO's view on AI economics is not a signal. If the strongest thing you found is commentary, return {"signals":[]}.

Every signal must state operating_need: one sentence naming the specific work ${account.name} needs done that Nine-67 could build or run instead of a hire. If you cannot name it from the source, the signal does not qualify.

Known context from the supplied target file (treat as a research lead, not proof):
- Segment: ${context?.subSegment || "not supplied"}
- Revenue band: ${context?.revenueBand || "not supplied"}
- Named CEO: ${context?.ceo || "not supplied"}
- Likely buyer roles: ${context?.buyerTitles.join(", ") || "not supplied"}
- AI/automation clue: ${context?.aiSignal || "not supplied"}
- Starting source: ${context?.sourceUrl || "not supplied"}

Verify every returned claim with a public URL and an exact observed or publication date. Never turn the supplied clue into a fact unless the web source supports it. Allowed types: job_post, job_cluster, exec_post, new_leader, funding, event, stack_change, other. Never invent a URL, person, date, post text, or engagement count.

For an executive post, include post with the actual visible text, author name, author title, exact published date/time, visible engagement counts or null, hashtags actually present, and is_excerpt=true when only a verified excerpt is available. Put that same individual first in people. For other evidence, include source with its exact headline, publisher, author if shown, date, and a faithful excerpt. Omit post or source instead of filling it with invented content.

Return JSON only as {"signals":[{"type":"job_cluster","evidence_kind":"hiring","operating_need":"the specific work they need done","summary":"why this matters","source_url":"https://...","observed_at":"YYYY-MM-DD","people":[{"name":"Full name","title":"Exact title","role_in_signal":"hiring_manager"}],"job":{"title":"Exact role title","department":"","days_open":0,"reposted":false,"salary_max":0,"tools_named":[],"responsibilities":[]},"confidence":0.0}]} or, for a post asking for help, {"signals":[{"type":"exec_post","evidence_kind":"asking_for_help","operating_need":"...","summary":"...","source_url":"https://...","observed_at":"YYYY-MM-DD","people":[{"name":"Full name","title":"Exact title","role_in_signal":"posted"}],"post":{"text":"actual visible post text","author_name":"Full name","author_title":"Exact title","published_at":"ISO date or date","reactions":null,"comments":null,"reposts":null,"hashtags":[],"is_excerpt":true},"confidence":0.0}]}. Return an empty array when no dated, source-backed operating need exists within 180 days.`;
  const tools = [webSearchTool(maxSearches)];
  const create = (selectedModel: string) => completeTurn({ model: selectedModel, max_tokens: SCOUT_MAX_TOKENS, tools }, prompt, recordUsage);
  let selectedModel = model;
  let response;
  try {
    response = await create(selectedModel);
  } catch (error) {
    const fallbackModel = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
    const status = (error as { status?: number }).status;
    if (selectedModel === fallbackModel || ![400, 404].includes(status ?? 0)) throw error;
    selectedModel = fallbackModel;
    response = await create(selectedModel);
  }
  const parsed = scoutOutput.parse(jsonFrom(response));
  const kept = parsed.signals
    .filter((item) => item.confidence >= SCOUT_CONFIDENCE_FLOOR)
    .filter((item) => {
      const reason = disqualifySignal(item);
      if (reason) console.warn(`[night-watch] dropped ${item.type} for ${account.domain}: ${reason}`);
      return !reason;
    })
    .sort((left, right) => right.confidence - left.confidence);
  return { signals: kept.slice(0, 1), found: parsed.signals.length, kept: kept.length, model: selectedModel, stopReason: response.stop_reason };
}

export async function findPerson(account: string, signal: ScoutSignal, recordUsage?: UsageRecorder) {
  const model = utilityModel();
  const response = await completeTurn(
    { model, max_tokens: 1_500, tools: [webSearchTool(2)] },
    `Using public web search only, identify the most likely budget owner for this signal at ${account}: ${signal.summary}. Prefer a person directly named in the source or a publicly verified executive who owns the affected function. Return JSON only: {"name":"","title":"","linkedin_url":null,"alternates":[{"title":""}]}. Do not guess a name without public evidence.`,
    recordUsage,
  );
  return z.object({
    name: z.string(), title: z.string(), linkedin_url: z.string().nullable(),
    alternates: z.array(z.object({ title: z.string() })),
  }).parse(jsonFrom(response));
}

export async function writeAngle(input: unknown, recordUsage?: UsageRecorder) {
  const model = writingModel();
  const response = await client().messages.create({
    model, max_tokens: 900,
    messages: [{ role: "user", content: `Draft outreach from this source-backed dossier: ${JSON.stringify(input)}. Ground every line in the supplied post or source. The dossier's signal.operating_need is the work this company needs done; Nine-67 builds and runs AI and automation so an operating team does not have to hire for that work. Lead with that need in their words, then offer the specific alternative to the hire or the specific answer to their question. Never invent familiarity, results, budget, or intent, and never comment on industry trends. Produce both LinkedIn and email copy even when contact details are unavailable. LinkedIn comment: two useful sentences replying to the actual post, with no pitch; leave empty only when the source is not a post. LinkedIn connection note: under 200 characters, specific to the source, no link. Email subject: under 6 words, lowercase. Email body: under 80 words, plain text, one low-friction question, no meeting request, one link maximum. For job signals, offer a free one-page JD teardown. Channel: intro for path 10; linkedin_only without verified email; linkedin_first for LinkedIn signals; otherwise email_first. Return JSON only: {"brief":"","why_now":"","channel":"email_first","linkedin_comment":"","linkedin_note":"","email_subject":"","email_body":""}.` }],
  });
  recordAnthropicUsage(response, model, recordUsage);
  return angle.parse(jsonFrom(response));
}

const jobSearchOutput = z.object({
  postings: z.array(z.object({
    title: z.string().min(2),
    url: z.url({ protocol: /^https?$/ }),
    posted_at: z.string().nullable().default(null),
    location: z.string().nullable().default(null),
  })).default([]),
});

const aiPostsOutput = z.object({
  posts: z.array(z.object({
    author_name: z.string().min(2),
    author_title: z.string().default(""),
    url: z.url({ protocol: /^https?$/ }),
    posted_at: z.string().nullable().default(null),
    excerpt: z.string().min(20),
    platform: z.string().default(""),
    topic: z.string().default(""),
  })).default([]),
});

/**
 * Anyone at the company posting publicly about AI or automation in their own
 * work. Small model, two searches, no opinion columns or press: the post
 * must be by a named person who works there, in their own words.
 */
export async function searchAiPosts(account: { name: string; domain: string }, recordUsage?: UsageRecorder, options: { maxSearches?: number; model?: string } = {}) {
  const model = options.model ?? searchModel();
  const maxSearches = Math.max(1, Math.min(10, options.maxSearches ?? 2));
  const response = await completeTurn(
    { model, max_tokens: 6_000, tools: [webSearchTool(maxSearches)] },
    `Find public posts from the last 180 days by people who work at ${account.name} (${account.domain}) about AI, automation, AI agents, data, systems, or making their own work or team more efficient: what they are trying, what is hard, what they want, what they built, or asking for help or recommendations. Run at least two searches on LinkedIn: site:linkedin.com/posts "${account.name}" AI, and site:linkedin.com/pulse "${account.name}"; then X, personal blogs, podcasts and conference talks. Only count a post if a named person who works at ${account.name} wrote it in their own words (a repost with their own comment counts; a company-page post counts only when a named person is quoted as its author). Do not count press releases, news articles, interviews in publications or opinion columns in magazines. For each post give the author's full name and title as shown, the URL of the post, the date as YYYY-MM-DD when shown, a verbatim excerpt of up to 400 characters, the platform, and a three-to-six-word topic. Up to 10 posts. Return JSON only: {"posts":[{"author_name":"","author_title":"","url":"https://...","posted_at":null,"excerpt":"","platform":"linkedin","topic":""}]}. Return {"posts":[]} if there are none.`,
    recordUsage,
  );
  return { posts: aiPostsOutput.parse(jsonFrom(response)).posts, model };
}

function searchModel() {
  return process.env.ANTHROPIC_SEARCH_MODEL ?? "claude-haiku-4-5";
}

const peopleSearchOutput = z.object({
  people: z.array(z.object({
    name: z.string().min(3),
    title: z.string().min(2),
    linkedin_url: z.string().nullable().default(null),
    source_url: z.string().nullable().default(null),
  })).default([]),
  email_examples: z.array(z.string()).default([]),
});

/**
 * Who works there, from the public web: LinkedIn profile search results,
 * the company's own site, press releases and bios. Also any work addresses
 * seen on public pages, so the company's email format can be learned.
 */
export async function searchPeopleWeb(account: { name: string; domain: string }, wantedTitles: string[], recordUsage?: UsageRecorder, options: { maxSearches?: number; model?: string } = {}) {
  const model = options.model ?? searchModel();
  const maxSearches = Math.max(1, Math.min(10, options.maxSearches ?? 6));
  const titles = wantedTitles.slice(0, 12).join(", ") || "executives and operations, technology, data and finance leaders";
  const response = await completeTurn(
    { model, max_tokens: 6_000, tools: [webSearchTool(maxSearches)] },
    `List people who currently work at ${account.name} (${account.domain}), most useful first: ${titles}, then other managers and leaders in operations, technology, data, finance, revenue and customer teams. Search LinkedIn profile results (site:linkedin.com/in "${account.name}"), the company's leadership or team page, press releases and conference bios. Only include people you actually saw named with a title at ${account.name}; skip people who have left. Also record every work email address at @${account.domain} you see on public pages (press contacts, author bios, PDF footers) so the address format can be learned; never invent one. Up to 30 people. Return JSON only: {"people":[{"name":"","title":"","linkedin_url":null,"source_url":null}],"email_examples":[]}.`,
    recordUsage,
  );
  const parsed = peopleSearchOutput.parse(jsonFrom(response));
  return { people: parsed.people, emailExamples: parsed.email_examples.filter((email) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)), model };
}

/**
 * Last resort for a company whose careers page cannot be read: ask a small
 * model to list the company's open roles from public job boards. Cheap
 * (two searches, Haiku) and only used when the direct read found nothing.
 */
export async function searchJobBoards(account: { name: string; domain: string }, recordUsage?: UsageRecorder, options: { maxSearches?: number; model?: string } = {}) {
  const model = options.model ?? searchModel();
  const maxSearches = Math.max(1, Math.min(10, options.maxSearches ?? 2));
  const response = await completeTurn(
    { model, max_tokens: 6_000, tools: [webSearchTool(maxSearches)] },
    `List the currently open job postings at ${account.name} (${account.domain}) that appear on public job boards such as LinkedIn Jobs, Indeed, Glassdoor or ZipRecruiter, or on the company's own careers site. Search for "${account.name}" jobs. Return only postings you actually saw, each with the exact title and the URL of the listing, the posting date as YYYY-MM-DD when shown, and the location. Up to 30 postings. Ignore postings at other companies with similar names. Return JSON only: {"postings":[{"title":"","url":"https://...","posted_at":null,"location":null}]}. Return {"postings":[]} if you find none.`,
    recordUsage,
  );
  const parsed = jobSearchOutput.parse(jsonFrom(response));
  return { postings: parsed.postings, model };
}

export async function classifyReply(body: string) {
  const model = utilityModel();
  const response = await client().messages.create({
    model, max_tokens: 60,
    messages: [{ role: "user", content: `Classify this email reply as exactly one of positive, neutral, objection, referral, ooo, negative. Return only the label.\n${body.slice(0, 5000)}` }],
  });
  return z.enum(["positive", "neutral", "objection", "referral", "ooo", "negative"]).parse(text(response.content).trim().toLowerCase());
}

const simulationOutput = z.object({
  variants: z.array(z.object({
    label: z.enum(["A", "B"]), subject: z.string(), body: z.string(), score: z.number().min(0).max(100),
    dimensions: z.object({ relevance: z.number().min(0).max(100), specificity: z.number().min(0).max(100), trust: z.number().min(0).max(100), replyEase: z.number().min(0).max(100) }),
    summary: z.string(),
  })).length(2),
  panel: z.array(z.object({ persona: z.string(), vote: z.enum(["A", "B"]), concern: z.string(), suggestion: z.string() })).length(4),
  winner: z.enum(["A", "B"]), confidence: z.number().min(0).max(100),
});

export async function simulateMessages(input: SimulationInput): Promise<SimulationResult> {
  const background = input.context.slice(0, 1500);
  const focusAreas = input.focusAreas.filter(Boolean).slice(0, 5).map((area) => area.slice(0, 120));
  const prompt = `You are running a rigorous pre-send message simulation. Compare variants A and B for ${input.personName} at ${input.company}. Channel: ${input.channel}. Signal: ${input.signalSummary}.

## Decision the team needs answered
${input.goal.slice(0, 240)}

## Background the team shared (their real situation — react to the messages in this light)
${background || "No additional context."}

## The team asked the room to weigh these specifically
${focusAreas.length ? focusAreas.map((area) => `- ${area}`).join("\n") : "- relevance\n- trust\n- ease of reply"}
Where relevant, aim each concern and suggestion at these lenses. Do not invent proof, relationships, results, or company facts.

## Prior observed experiment outcomes
${input.outcomeHistory || "No completed message experiments yet. Do not invent historical performance."}
Use real outcomes only as light calibration; do not let a small sample override the current prospect and signal.

## Variants
${JSON.stringify(input.variants)}

Simulate exactly four perspectives: the operator who owns the work, a busy executive, a skeptical buyer, and a message-quality/filter reviewer. Score each variant 0-100 on relevance, specificity, trust, and replyEase. Prefer concrete signal use, restraint, brevity, and a low-friction reply. Penalize generic praise, manufactured familiarity, hype, repetition, or meeting asks. This is directional qualitative judgment, never a predicted response rate.

Return JSON only: {"variants":[{"label":"A","subject":"","body":"","score":0,"dimensions":{"relevance":0,"specificity":0,"trust":0,"replyEase":0},"summary":""},{"label":"B","subject":"","body":"","score":0,"dimensions":{"relevance":0,"specificity":0,"trust":0,"replyEase":0},"summary":""}],"panel":[{"persona":"The operator","vote":"A","concern":"","suggestion":""},{"persona":"The busy executive","vote":"A","concern":"","suggestion":""},{"persona":"The skeptic","vote":"A","concern":"","suggestion":""},{"persona":"The message filter","vote":"A","concern":"","suggestion":""}],"winner":"A","confidence":0}`;
  const model = utilityModel();
  const response = await client().messages.create({ model, max_tokens: 1_400, messages: [{ role: "user", content: prompt }] });
  const parsed = simulationOutput.parse(jsonFrom(response));
  const variants = parsed.variants.map((scored) => ({ ...scored, ...input.variants.find((original) => original.label === scored.label)! }));
  return { ...parsed, variants, model };
}
