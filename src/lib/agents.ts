import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SimulationInput, SimulationResult } from "@/lib/message-simulation";
import { recordAnthropicUsage, type UsageRecorder } from "./anthropic-cost";

const signal = z.object({
  type: z.enum(["job_post", "job_cluster", "exec_post", "new_leader", "funding", "event", "stack_change", "other"]),
  summary: z.string(),
  source_url: z.url(),
  observed_at: z.string(),
  people: z.array(z.object({ name: z.string(), title: z.string(), role_in_signal: z.string() })).default([]),
  post: z.object({
    text: z.string(), author_name: z.string(), author_title: z.string(), published_at: z.string(),
    reactions: z.number().int().nonnegative().nullable().default(null),
    comments: z.number().int().nonnegative().nullable().default(null),
    reposts: z.number().int().nonnegative().nullable().default(null),
    hashtags: z.array(z.string()).default([]), is_excerpt: z.boolean().default(false),
  }).optional(),
  source: z.object({
    headline: z.string(), publisher: z.string(), author_name: z.string().nullable().default(null),
    published_at: z.string(), excerpt: z.string(),
  }).optional(),
  job: z.object({
    title: z.string(), department: z.string(), days_open: z.number(), reposted: z.boolean(),
    salary_max: z.number(), tools_named: z.array(z.string()), responsibilities: z.array(z.string()),
  }).optional(),
  confidence: z.number().min(0).max(1),
});

export const scoutOutput = z.object({ signals: z.array(signal) });
export type ScoutSignal = z.infer<typeof signal>;

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
  return process.env.ANTHROPIC_RESEARCH_MODEL ?? "claude-haiku-4-5";
}

function writingModel() {
  return process.env.ANTHROPIC_WRITING_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";
}

function utilityModel() {
  return process.env.ANTHROPIC_UTILITY_MODEL ?? "claude-haiku-4-5";
}

function text(blocks: Anthropic.Messages.ContentBlock[]) {
  return blocks.filter((block): block is Anthropic.Messages.TextBlock => block.type === "text").map((block) => block.text).join("\n");
}

function jsonFrom(value: string) {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return JSON.parse(match?.[1] ?? value);
}

export async function scout(account: {
  name: string; domain: string; vertical?: string | null; employee_range?: string | null;
  careers_url?: string | null; news_query?: string | null;
  researchContext?: { aiSignal: string; sourceUrl: string; ceo: string; buyerTitles: string[]; revenueBand: string; subSegment: string };
}, recordUsage?: UsageRecorder) {
  const context = account.researchContext;
  const model = researchModel();
  const maxSearches = Math.max(1, Math.min(5, Number(process.env.ANTHROPIC_MAX_SEARCHES_PER_COMPANY ?? 3)));
  const prompt = `Research ${account.name} (${account.domain}), a ${account.vertical ?? "target"} company with ${account.employee_range ?? "unknown"} employees.

Find the single strongest verifiable public development that creates a credible reason for an operations, automation, data, or AI conversation. FIRST inspect the supplied starting source with web_fetch when that tool is available. Only use web search if that source is inaccessible, stale, or does not identify a useful development. Look for a public LinkedIn post, article, interview, or conference comment from a named executive in the likely buyer group, then company news, ${account.careers_url ?? "the careers page"}, leadership changes, hiring clusters, acquisitions, funding, and technology changes. Prioritize the last 30 days. If nothing qualifies in 30 days, use the strongest relevant development from the last 180 days.

Known context from the supplied target file (treat as a research lead, not proof):
- Segment: ${context?.subSegment || "not supplied"}
- Revenue band: ${context?.revenueBand || "not supplied"}
- Named CEO: ${context?.ceo || "not supplied"}
- Likely buyer roles: ${context?.buyerTitles.join(", ") || "not supplied"}
- AI/automation clue: ${context?.aiSignal || "not supplied"}
- Starting source: ${context?.sourceUrl || "not supplied"}

Verify every returned claim with a public URL and an exact observed or publication date. Never turn the supplied clue into a fact unless the web source supports it. Allowed types: job_post, job_cluster, exec_post, new_leader, funding, event, stack_change, other. Never invent a URL, person, date, post text, or engagement count.

For an executive post, include post with the actual visible text, author name, author title, exact published date/time, visible engagement counts or null, hashtags actually present, and is_excerpt=true when only a verified excerpt is available. Put that same individual first in people. For other evidence, include source with its exact headline, publisher, author if shown, date, and a faithful excerpt. Omit post or source instead of filling it with invented content.

Return JSON only as {"signals":[{"type":"exec_post","summary":"why this matters","source_url":"https://...","observed_at":"YYYY-MM-DD","people":[{"name":"Full name","title":"Exact title","role_in_signal":"Author and operating owner"}],"post":{"text":"actual visible post text","author_name":"Full name","author_title":"Exact title","published_at":"ISO date or date","reactions":null,"comments":null,"reposts":null,"hashtags":[],"is_excerpt":true},"confidence":0.0}]}. Return an empty array only when no dated, source-backed development exists within 180 days.`;
  const tools: Anthropic.Messages.Tool[] = [];
  const sourceIsPdf = /\.pdf(?:$|[?#])/i.test(context?.sourceUrl ?? "");
  if (context?.sourceUrl && !sourceIsPdf) tools.push({
    type: "web_fetch_20250910", name: "web_fetch", max_uses: 1, max_content_tokens: 3_000,
    citations: { enabled: true },
  } as unknown as Anthropic.Messages.Tool);
  tools.push({ type: "web_search_20250305", name: "web_search", max_uses: maxSearches } as unknown as Anthropic.Messages.Tool);
  const response = await client().messages.create({
    model, max_tokens: 2_200, messages: [{ role: "user", content: prompt }], tools,
  });
  recordAnthropicUsage(response, model, recordUsage);
  return scoutOutput.parse(jsonFrom(text(response.content))).signals.filter((item) => item.confidence >= 0.6).slice(0, 1);
}

export async function findPerson(account: string, signal: ScoutSignal, recordUsage?: UsageRecorder) {
  const model = utilityModel();
  const response = await client().messages.create({
    model, max_tokens: 600,
    messages: [{ role: "user", content: `Using public web search only, identify the most likely budget owner for this signal at ${account}: ${signal.summary}. Prefer a person directly named in the source or a publicly verified executive who owns the affected function. Return JSON only: {"name":"","title":"","linkedin_url":null,"alternates":[{"title":""}]}. Do not guess a name without public evidence.` }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 } as unknown as Anthropic.Messages.Tool],
  });
  recordAnthropicUsage(response, model, recordUsage);
  return z.object({
    name: z.string(), title: z.string(), linkedin_url: z.string().nullable(),
    alternates: z.array(z.object({ title: z.string() })),
  }).parse(jsonFrom(text(response.content)));
}

export async function writeAngle(input: unknown, recordUsage?: UsageRecorder) {
  const model = writingModel();
  const response = await client().messages.create({
    model, max_tokens: 900,
    messages: [{ role: "user", content: `Draft outreach from this source-backed dossier: ${JSON.stringify(input)}. Ground every line in the supplied post or source. Name the specific public claim or operating change naturally; never invent familiarity, results, budget, or intent. Produce both LinkedIn and email copy even when contact details are unavailable. LinkedIn comment: two useful sentences replying to the actual post, with no pitch; leave empty only when the source is not a post. LinkedIn connection note: under 200 characters, specific to the source, no link. Email subject: under 6 words, lowercase. Email body: under 80 words, plain text, one low-friction question, no meeting request, one link maximum. For job signals, offer a free one-page JD teardown. Channel: intro for path 10; linkedin_only without verified email; linkedin_first for LinkedIn signals; otherwise email_first. Return JSON only: {"brief":"","why_now":"","channel":"email_first","linkedin_comment":"","linkedin_note":"","email_subject":"","email_body":""}.` }],
  });
  recordAnthropicUsage(response, model, recordUsage);
  return angle.parse(jsonFrom(text(response.content)));
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
  const parsed = simulationOutput.parse(jsonFrom(text(response.content)));
  const variants = parsed.variants.map((scored) => ({ ...scored, ...input.variants.find((original) => original.label === scored.label)! }));
  return { ...parsed, variants, model };
}
