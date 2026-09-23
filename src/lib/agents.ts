import { authoredDraft } from "./authored-outreach.ts";
import { angleFor } from "./contact-draft.ts";
import { OUTREACH_EVIDENCE } from "./outreach-proof.ts";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SimulationInput, SimulationResult } from "@/lib/message-simulation";
import { recordAnthropicUsage, type UsageRecorder } from "./anthropic-cost.ts";
import { parseModelJson } from "./model-output.ts";
import { fallbackChain, researchModel, searchModel, utilityModel, webSearchToolType, writingModel } from "./models.ts";
import { sanitizeLinks } from "./sender.ts";

/** Once a model is rejected and a working one is found, later calls skip straight to it instead of retrying the dead model every time. */
const resolvedModel = new Map<string, string>();

export { parseModelJson } from "./model-output.ts";

/** Signals below this confidence are not stored. Shown on the run log as "found, below threshold". */
export const SCOUT_CONFIDENCE_FLOOR = 0.6;

/**
 * The scout answer shares max_tokens with the narration around up to
 * maxSearches searches, so it needs headroom; a truncated reply is detected
 * by stop_reason and reported as truncation, never as bad JSON.
 */
export const SCOUT_MAX_TOKENS = 12_000;

/**
 * A server-tool turn pauses with stop_reason=pause_turn after the API's own
 * search-loop limit. The turn is resumed by re-sending the conversation with
 * the assistant content appended; this caps how many times that happens.
 */
export const MAX_TURN_CONTINUATIONS = 3;

/** A single model turn may not run longer than this; a hung web-search call fails fast instead of eating the run window. */
export const TURN_TIMEOUT_MS = 75_000;

/** `YYYY-MM-DD`; an ISO datetime is trimmed to its date part first. A future date is clamped to today so a model cannot stamp tomorrow to dodge recency decay. */
const isoDate = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const date = value.trim().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today ? today : date;
  },
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
  "process and workflow automation", "data and reporting", "operations analyst", "RevOps", "systems and integration", "CRM administration", "applied AI for internal operations (an internal assistant, not an AI product)",
] as const;

/** Roles that look like the target but are not: building AI as a product or doing AI/ML research is not work Nine-67 can quickly do for a company. */
export const NOT_TARGET_ROLES = "machine learning engineer, ML/AI research or applied scientist, data scientist, computer vision, NLP, deep learning, robotics, or any role building an AI/ML product";

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
  linkedin_comment: z.string(), linkedin_note: z.string().transform((value) => value.trim().slice(0, 300)),
  linkedin_message: z.string().default(""),
  linkedin_subject: z.string().default(""),
  email_subject: z.string(), email_body: z.string(),
});
export type OutreachDraft = z.infer<typeof angle>;
/** Strip any fabricated/foreign links from a draft so only the real homepage can reach a prospect. */
function cleanDraft(draft: OutreachDraft): OutreachDraft {
  return { ...draft, email_body: sanitizeLinks(draft.email_body), linkedin_message: sanitizeLinks(draft.linkedin_message), linkedin_note: sanitizeLinks(draft.linkedin_note), linkedin_comment: sanitizeLinks(draft.linkedin_comment) };
}

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing");
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function text(blocks: Anthropic.Messages.ContentBlock[]) {
  return blocks.filter((block): block is Anthropic.Messages.TextBlock => block.type === "text").map((block) => block.text).join("\n");
}

function jsonFrom(response: Pick<Anthropic.Messages.Message, "content" | "stop_reason">) {
  return parseModelJson(response.content, response.stop_reason);
}

/** The web-search server tool in the version the model takes; the caller passes the model so the two never drift apart. */
function webSearchTool(model: string, maxUses: number): Anthropic.Messages.ToolUnion {
  return { type: webSearchToolType(model), name: "web_search", max_uses: maxUses } as Anthropic.Messages.ToolUnion;
}

/**
 * The model is rejected for this key — not found (404), no access (403), or an
 * invalid/unsupported model (400). Any of these means the fallback chain should
 * try a different model, since retrying the same one will keep failing.
 */
function isUnknownModelError(error: unknown) {
  if (error instanceof Anthropic.NotFoundError) return true;
  if (error instanceof Anthropic.PermissionDeniedError) return true;
  const message = error instanceof Error ? error.message : "";
  if (error instanceof Anthropic.BadRequestError && /model/i.test(message)) return true;
  // A 403/404-style access denial that names the model, whatever the SDK class.
  return /\bmodel\b/i.test(message) && /(not[_ ]?found|does not (exist|have access)|no access|not (available|allowed|permitted|enabled|supported)|permission|unsupported|invalid|unauthori[sz]ed)/i.test(message);
}

/** Run one turn on one model. */
async function completeTurnOn(
  model: string,
  params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages" | "model" | "tools"> & { searches?: number },
  prompt: string,
  recordUsage?: UsageRecorder,
) {
  const { searches, ...rest } = params;
  const request = { ...rest, model, ...(searches ? { tools: [webSearchTool(model, searches)] } : {}) };
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: prompt }];
  const options = { timeout: TURN_TIMEOUT_MS, maxRetries: 1 };
  let response = await client().messages.create({ ...request, messages }, options);
  recordAnthropicUsage(response, model, recordUsage);
  for (let round = 0; round < MAX_TURN_CONTINUATIONS && response.stop_reason === "pause_turn"; round += 1) {
    messages.push({ role: "assistant", content: response.content });
    response = await client().messages.create({ ...request, messages }, options);
    recordAnthropicUsage(response, model, recordUsage);
  }
  return response;
}

/**
 * Run one request to completion. When the server-side search loop pauses the
 * turn, re-send the conversation with the assistant content appended so the
 * API resumes where it left off; usage is recorded for every round. When the
 * API does not know the configured model, the request is retried once on the
 * current default so a retired model id stops a run with a clear message
 * instead of silently failing every company.
 */
async function completeTurn(
  params: Omit<Anthropic.Messages.MessageCreateParamsNonStreaming, "messages" | "tools"> & { searches?: number },
  prompt: string,
  recordUsage?: UsageRecorder,
): Promise<{ response: Anthropic.Messages.Message; model: string }> {
  const { model, ...rest } = params;
  const start = resolvedModel.get(model) ?? model;
  try {
    return { response: await completeTurnOn(start, rest, prompt, recordUsage), model: start };
  } catch (error) {
    if (!isUnknownModelError(error)) throw error;
    // The configured model is not available to this key. Try each safety-net model until one works — whatever
    // the error on a given candidate (model access, or a web-search tool version the org does not have),
    // move on to the next — and remember the one that works so later calls skip straight to it.
    let last: unknown = error;
    for (const candidate of fallbackChain(model)) {
      try {
        const response = await completeTurnOn(candidate, rest, prompt, recordUsage);
        resolvedModel.set(model, candidate);
        console.warn(`[night-watch] model ${start} was rejected for this key; using ${candidate} instead. Set ANTHROPIC_RESEARCH_MODEL to a model this key can use.`);
        return { response, model: candidate };
      } catch (inner) {
        last = inner;
      }
    }
    throw last;
  }
}

/** One model turn with web search that must answer in JSON. The analysis agents are built on this. */
export async function runSearchAgent(prompt: string, options: { model: string; maxSearches: number; maxTokens?: number }, recordUsage?: UsageRecorder): Promise<unknown> {
  const { response } = await completeTurn({ model: options.model, max_tokens: options.maxTokens ?? 16_000, searches: Math.max(1, Math.min(10, options.maxSearches)) }, prompt, recordUsage);
  return jsonFrom(response);
}

/** One model turn with no tools that must answer in JSON. */
export async function runWritingAgent(prompt: string, options: { model: string; maxTokens?: number }, recordUsage?: UsageRecorder): Promise<unknown> {
  const { response } = await completeTurn({ model: options.model, max_tokens: options.maxTokens ?? 8_000 }, prompt, recordUsage);
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
1. hiring (type job_post or job_cluster): open roles on ${account.careers_url ?? "the careers page"} or job boards in these families: ${TARGET_JOB_FAMILIES.join(", ")}. Do NOT count ${NOT_TARGET_ROLES}: those build AI, and Nine-67 does operational automation, not someone else's AI product. Clusters of related roles, reposted roles, and roles open 30+ days are the strongest. Capture the exact title, department, days open, whether reposted, salary maximum if shown, tools named, and the responsibilities as written.
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
  const { response, model: selectedModel } = await completeTurn({ model, max_tokens: SCOUT_MAX_TOKENS, searches: maxSearches }, prompt, recordUsage);
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
  const { response } = await completeTurn(
    { model, max_tokens: 4_000, searches: 2 },
    `Using public web search only, identify the most likely budget owner for this signal at ${account}: ${signal.summary}. Prefer a person directly named in the source or a publicly verified executive who owns the affected function. Return JSON only: {"name":"","title":"","linkedin_url":null,"alternates":[{"title":""}]}. Do not guess a name without public evidence.`,
    recordUsage,
  );
  return z.object({
    name: z.string(), title: z.string(), linkedin_url: z.string().nullable(),
    alternates: z.array(z.object({ title: z.string() })),
  }).parse(jsonFrom(response));
}

/**
 * Output room for the drafting and judging calls. The current models think
 * before they answer and the thinking counts against max_tokens, so a cap
 * sized to the visible answer alone cuts the answer off.
 */
const WRITING_MAX_TOKENS = 4_000;

/** The rules every draft follows, whichever evidence it is written from. */
const DRAFT_RULES = `Write a useful first-touch note from Nine-67 to this specific buyer. Optimize for a qualified reply, not a meeting demand or generic curiosity.
APPROVED EVIDENCE: ${OUTREACH_EVIDENCE}
First decide what this company SELLS and what this person OWNS. Never pitch a software vendor its own product capability, treat a consultancy as its end customer, or offer to replace employees. For established technology providers, explore a bounded INTERNAL operating workflow or an explicit delivery partnership, only when supported by the context.
Choose one concrete business decision or handoff. State any unverified pain as a hypothesis, not inside knowledge. Connect it to a relevant delivered example or a clearly proposed first application. A process paragraph alone is not a reason to reply. Explain what the recipient would get from answering: a specific example, a useful comparison, or a scoped next step. Do not invent an attachment or an already-prepared personalized analysis.
Use 55-100 words plus the saved greeting/sign-off. Name the company naturally. Use plain short subjects (3-7 words where possible), not a job title list or a slogan. Vary the structure based on the argument: relevant proof first, a company observation first, or a useful point of view first. Do not force every draft into the same three-paragraph skeleton. Use the 20-app engagement only when scale is relevant, not by quota. Do not add a default self-introduction; the signature identifies the sender. Preserve any explicitly supplied personal introduction, greeting and sign-off.
One easy-to-answer question with a concrete reason to respond. No demand to diagnose their whole business, no "what keeps you up at night", no "worth a chat", no "is this on your radar". No fake familiarity, congratulatory filler, unsupported ROI, guaranteed results, or claim that every case is deployed. Never infer a firm's internal problems from a job posting. An old posting is context, not proof of a current vacancy.
LinkedIn must take a different angle from email. Connection note under200 characters; message60-100words; comment only when responding to an actual supplied post. No URLs in the first-touch body; signature handles the site. No invented recipient or sender role.
Return JSON only: {"brief":"","why_now":"","channel":"email_first","linkedin_comment":"","linkedin_note":"","linkedin_message":"","linkedin_subject":"","email_subject":"","email_body":""}.`;


export async function writeAngle(input: unknown, recordUsage?: UsageRecorder): Promise<OutreachDraft> {
  const { response } = await completeTurn({
    model: writingModel(), max_tokens: WRITING_MAX_TOKENS,
  }, `Draft outreach from this source-backed dossier: ${JSON.stringify(input)}. Ground every line in the supplied post or source. Treat the dossier's operating_need as a hypothesis to assess, not a claim to repeat. Use relevant Nine-67 proof and a proposed internal workflow. Do not reproduce legacy hiring-replacement language from the dossier. Channel: intro for path 10; linkedin_only without verified email; linkedin_first for LinkedIn signals; otherwise email_first. ${DRAFT_RULES}`, recordUsage);
  return cleanDraft(angle.parse(jsonFrom(response)));
}

export type BriefDraftInput = {
  company: { name: string; domain: string; industry: string };
  person: { name: string; title: string; why: string; quotes: Array<{ quote: string; url: string; date: string | null }>; emailState: "verified" | "unverified" | "none"; linkedin: boolean };
  brief: { whyNow: string; angle: string; opener: string; objections: string[] };
  roles: Array<{ title: string; why: string; postedAt?: string | null }>;
  buildInstead: string[];
  happening: string[];
};

/**
 * Draft outreach from the agent swarm's brief rather than from a single
 * signal: the person the synthesizer chose, the angle, their own words when
 * they have said something publicly, and the roles Nine-67 would build a
 * system for instead. Everything in the input was found on a public page.
 */
export async function writeOutreachFromBrief(input: BriefDraftInput, recordUsage?: UsageRecorder): Promise<OutreachDraft> {
  const { response } = await completeTurn({
    model: writingModel(), max_tokens: WRITING_MAX_TOKENS,
  }, `Draft first-touch outreach for the person below, from a research brief. Everything here was found on public pages; use only what is here. ${JSON.stringify(input)}\n\nNine-67 builds and runs AI and automation for operating teams at $50M-1B companies, working with leaders and users through iteration, training and deployment. Lead with the specific thing seen: their own post or quote when there is one (quote a phrase of it), otherwise the role they are hiring for, otherwise the concrete development in "happening". Then connect the relevant workflow to an approved delivery example. Never claim to replace the roles they are hiring. The brief's opener is a starting point, not copy to paste. If person.quotes is empty, linkedin_comment must be empty. Channel: linkedin_only when emailState is none; linkedin_first when emailState is unverified or when the evidence is their own post; otherwise email_first. ${DRAFT_RULES}`, recordUsage);
  return cleanDraft(angle.parse(jsonFrom(response)));
}

/**
 * Refine one existing outreach draft in place — the desk's "Refine with AI" on the email or LinkedIn message.
 * Keeps it a first-touch from Nine-67, concise and specific to the person, and applies an optional instruction.
 */
export async function refineDraft(input: { channel: "email" | "linkedin"; company: string; person: string; title: string; whyNow: string; subject?: string; body: string; instruction?: string; senderName?: string; senderTitle?: string; domain?: string; greeting?: string; signoff?: string; intro?: string }, recordUsage?: UsageRecorder): Promise<{ subject?: string; body: string }> {
  const first = input.person.trim().split(/\s+/)[0] || "there";
  const senderName = input.senderName?.trim() || "the Nine-67 sender";
  const senderRole = input.senderTitle?.trim() ? `${input.senderTitle.trim()} of Nine-67` : "Nine-67";
  // Write as the actual founder reaching out personally — this is what turns the bland default into her voice.
  const voice = `Write it in the first person as ${senderName}, ${senderRole}, in their own voice: a real founder reaching out personally — warm, direct, confident, with a little personality, like someone who did their homework. Never corporate, templated, or "marketing"; no buzzwords, no hype.`;
  const avoid = `Sound like a person, not a vendor. Never use em dashes (—) or en dashes (–) — use a comma or two short sentences. AVOID (these read as AI spam and get deleted): inventing a product name for what you'd build ("an AI-driven platform orchestration tool", "an X engine/platform/suite"); buzzwords ("AI-driven", "orchestration", "leverage", "streamline", "seamless", "end-to-end", "solutions", "synergy"); pasting raw job-title strings into a sentence; and claiming to know their internal process. Instead say in ONE plain sentence the single thing you'd build and the outcome, the way a founder would say it out loud to a peer.`;
  const ask = input.instruction?.trim()
    ? `Apply this instruction from the sender: "${input.instruction.trim()}". Otherwise rewrite it to read like a real founder's note.`
    : `Rewrite it to read like a real founder's personal note — keep only the factual hook (the specific thing seen); fix anything that sounds like AI vendor copy. Vary the closing question; never use the word "teardown", and never put a link in the body (the website is in the signature).`;
  const reference = authoredDraft(input.company, angleFor(input.title), input.domain);
  const greeting = (input.greeting || "Hi {first},").replace(/\{first\}/gi, first).replace(/\{name\}/gi, input.person);
  const intro = `Preserve this greeting exactly: ${greeting}. End with the sender's sign-off: ${input.signoff || "Thank you,"}. Do not add a generic self-introduction. ${input.intro && input.intro !== "I am {name}, {title} at Nine-67." ? `Honor the saved introduction: ${input.intro}` : ""} ${reference ? `Reviewed company/buyer reference: ${JSON.stringify(reference)}. Keep its commercial reasoning; adapt to the actual recipient and user's instruction rather than mechanically copying it.` : ""}`;

  const subjectRule = input.channel === "email"
    ? "Write a subject line optimized to get a reply: specific to them, plain, sentence case (never all-lowercase), under about eight words, no clickbait."
    : "Write a short LinkedIn subject line of 3-6 words for an InMail: specific and human, no clickbait.";
  const shape = input.channel === "email" ? `{"subject":"a reply-optimized subject line","body":"the email"}` : `{"subject":"a short subject line","body":"the LinkedIn message"}`;
  const prompt = `You are rewriting a first-touch outreach ${input.channel} from Nine-67 (which works with leaders to build, iterate, train teams and deploy working business applications) to ${input.person}${input.title ? `, ${input.title}` : ""} at ${input.company}. Why now: ${input.whyNow || "—"}.\n\n${voice}\n\n${DRAFT_RULES}\n\n${OUTREACH_EVIDENCE}\n\n${avoid}\n\nHere is the current draft:\n${input.subject ? `Subject: ${input.subject}\n` : ""}${input.body}\n\n${ask} ${intro} ${subjectRule} Keep it ${input.channel === "email" ? "50-90 words" : "under 90 words"}, one clear low-friction question, plain text only. The ONLY link allowed is https://nine-67.com — keep it if present, never invent any other URL or path (no /case-study, /demo, etc.) and never link any other domain. Return JSON only: ${shape}.`;
  const json = await runWritingAgent(prompt, { model: writingModel(), maxTokens: 1_200 }, recordUsage) as { subject?: unknown; body?: unknown } | null;
  return {
    subject: typeof json?.subject === "string" && json.subject.trim() ? json.subject.trim() : undefined,
    body: sanitizeLinks(typeof json?.body === "string" && json.body.trim() ? json.body.trim() : input.body),
  };
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
  const { response } = await completeTurn(
    { model, max_tokens: 8_000, searches: maxSearches },
    `Find public posts from the last 180 days by people who work at ${account.name} (${account.domain}) about AI, automation, AI agents, data, systems, or making their own work or team more efficient: what they are trying, what is hard, what they want, what they built, or asking for help or recommendations. Run at least two searches on LinkedIn: site:linkedin.com/posts "${account.name}" AI, and site:linkedin.com/pulse "${account.name}"; then X, personal blogs, podcasts and conference talks. Only count a post if a named person who works at ${account.name} wrote it in their own words (a repost with their own comment counts; a company-page post counts only when a named person is quoted as its author). Do not count press releases, news articles, interviews in publications or opinion columns in magazines. For each post give the author's full name and title as shown, the URL of the post, the date as YYYY-MM-DD when shown, a verbatim excerpt of up to 400 characters, the platform, and a three-to-six-word topic. Up to 10 posts. Return JSON only: {"posts":[{"author_name":"","author_title":"","url":"https://...","posted_at":null,"excerpt":"","platform":"linkedin","topic":""}]}. Return {"posts":[]} if there are none.`,
    recordUsage,
  );
  return { posts: aiPostsOutput.parse(jsonFrom(response)).posts, model };
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
  const { response } = await completeTurn(
    { model, max_tokens: 8_000, searches: maxSearches },
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
  const { response } = await completeTurn(
    { model, max_tokens: 8_000, searches: maxSearches },
    `List the currently open job postings at ${account.name} (${account.domain}) that appear on public job boards such as LinkedIn Jobs, Indeed, Glassdoor or ZipRecruiter, or on the company's own careers site. Search for "${account.name}" jobs. Return only postings you actually saw, each with the exact title and the URL of the listing, the posting date as YYYY-MM-DD when shown, and the location. Up to 30 postings. Ignore postings at other companies with similar names. Return JSON only: {"postings":[{"title":"","url":"https://...","posted_at":null,"location":null}]}. Return {"postings":[]} if you find none.`,
    recordUsage,
  );
  const parsed = jobSearchOutput.parse(jsonFrom(response));
  return { postings: parsed.postings, model };
}

export async function classifyReply(body: string): Promise<"positive" | "neutral" | "objection" | "referral" | "ooo" | "negative"> {
  const { response } = await completeTurn({ model: utilityModel(), max_tokens: 1_000 }, `Classify this email reply as exactly one of positive, neutral, objection, referral, ooo, negative. Return only the label.\n${body.slice(0, 5000)}`);
  const raw = text(response.content).trim().toLowerCase();
  const labels = ["positive", "neutral", "objection", "referral", "ooo", "negative"] as const;
  // Tolerant match — the model sometimes returns "positive." or a short phrase. NEVER throw: a throw here
  // would skip recording the reply and leave the cadence sending to someone who already answered. Any reply
  // (even the "neutral" default) stops the cadence, which is the safe fallback.
  return labels.find((label) => raw === label) ?? labels.find((label) => raw.includes(label)) ?? "neutral";
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

export async function simulateMessages(input: SimulationInput, recordUsage?: UsageRecorder): Promise<SimulationResult> {
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
  const { response, model } = await completeTurn({ model: utilityModel(), max_tokens: WRITING_MAX_TOKENS }, prompt, recordUsage);
  const parsed = simulationOutput.parse(jsonFrom(response));
  const variants = parsed.variants.map((scored) => ({ ...scored, ...input.variants.find((original) => original.label === scored.label)! }));
  return { ...parsed, variants, model };
}
