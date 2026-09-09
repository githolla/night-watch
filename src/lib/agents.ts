import Anthropic from "@anthropic-ai/sdk";import { z } from "zod";import type { SimulationInput, SimulationResult } from "@/lib/message-simulation";
const signal=z.object({type:z.enum(["job_post","job_cluster","exec_post","new_leader","funding","event","stack_change","other"]),summary:z.string(),source_url:z.url(),observed_at:z.string(),people:z.array(z.object({name:z.string(),title:z.string(),role_in_signal:z.string()})).default([]),job:z.object({title:z.string(),department:z.string(),days_open:z.number(),reposted:z.boolean(),salary_max:z.number(),tools_named:z.array(z.string()),responsibilities:z.array(z.string())}).optional(),confidence:z.number().min(0).max(1)});
export const scoutOutput=z.object({signals:z.array(signal)});export type ScoutSignal=z.infer<typeof signal>;
const angle=z.object({brief:z.string(),why_now:z.string(),channel:z.enum(["linkedin_first","email_first","intro","linkedin_only"]),linkedin_comment:z.string(),linkedin_note:z.string().max(200),email_subject:z.string(),email_body:z.string()});
function client(){if(!process.env.ANTHROPIC_API_KEY)throw new Error("ANTHROPIC_API_KEY is missing");return new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY})}
function text(blocks:Anthropic.Messages.ContentBlock[]){return blocks.filter((b):b is Anthropic.Messages.TextBlock=>b.type==="text").map(b=>b.text).join("\n")}
function jsonFrom(value:string){const match=value.match(/```(?:json)?\s*([\s\S]*?)```/i);return JSON.parse(match?.[1]??value)}
// Anthropic's Tool union accepts this documented server tool at runtime; the SDK's generic overload selects the client-tool member first.
// @ts-expect-error documented server-side web search tool
export async function scout(account:{name:string;domain:string;vertical?:string|null;employee_range?:string|null;careers_url?:string|null;news_query?:string|null}){const prompt=`Research ${account.name} (${account.domain}), a ${account.vertical??"target"} company with ${account.employee_range??"unknown"} employees. Find public-web changes from the last 48 hours. Check news, ${account.careers_url??"the careers page"}, public LinkedIn pages via search only, funding, acquisitions, leadership, markets, conferences and events. Allowed types: job_post, job_cluster, exec_post, new_leader, funding, event, stack_change, other. Never invent a URL, person, or date. Return JSON only as {"signals":[{"type":"...","summary":"...","source_url":"https://...","observed_at":"YYYY-MM-DD","people":[{"name":"","title":"","role_in_signal":""}],"job":{"title":"","department":"","days_open":0,"reposted":false,"salary_max":0,"tools_named":[],"responsibilities":[]},"confidence":0.0}]}. Empty array if nothing qualifies.`;const response=await client().messages.create({model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5",max_tokens:3000,messages:[{role:"user",content:prompt}],tools:[{type:"web_search_20250305",name:"web_search",max_uses:8} as Anthropic.Messages.Tool]});return scoutOutput.parse(jsonFrom(text(response.content))).signals.filter(s=>s.confidence>=.6)}
// @ts-expect-error documented server-side web search tool
export async function findPerson(account:string,signal:ScoutSignal){const response=await client().messages.create({model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5",max_tokens:900,messages:[{role:"user",content:`Using public web search only, identify the most likely budgetкому owner for this signal at ${account}: ${signal.summary}. Return JSON only: {"name":"","title":"","linkedin_url":null,"alternates":[{"title":""}]}. Do not guess a name without public evidence.`}],tools:[{type:"web_search_20250305",name:"web_search",max_uses:4} as Anthropic.Messages.Tool]});return z.object({name:z.string(),title:z.string(),linkedin_url:z.string().nullable(),alternates:z.array(z.object({title:z.string()}))}).parse(jsonFrom(text(response.content)))}
export async function writeAngle(input:unknown){const response=await client().messages.create({model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5",max_tokens:1200,messages:[{role:"user",content:`Draft outreach from this JSON: ${JSON.stringify(input)}. First line names the signal. One idea. Ask for a reply, not a meeting. Comment: 2 useful sentences and no pitch, or empty if not a post. LinkedIn note under 200 chars, no link. Email subject under 6 words, lowercase. Email under 80 words, plain text, one link maximum. Never overclaim. For job signals offer a free one-page JD teardown. Channel: intro for path 10; linkedin_only without verified email; linkedin_first for LinkedIn signals; otherwise email_first. Return JSON only: {"brief":"","why_now":"","channel":"email_first","linkedin_comment":"","linkedin_note":"","email_subject":"","email_body":""}.`}],});return angle.parse(jsonFrom(text(response.content)))}
export async function classifyReply(body:string){const response=await client().messages.create({model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5",max_tokens:60,messages:[{role:"user",content:`Classify this email reply as exactly one of positive, neutral, objection, referral, ooo, negative. Return only the label.\n${body.slice(0,5000)}`}],});return z.enum(["positive","neutral","objection","referral","ooo","negative"]).parse(text(response.content).trim().toLowerCase())}

const simulationOutput=z.object({variants:z.array(z.object({label:z.enum(["A","B"]),subject:z.string(),body:z.string(),score:z.number().min(0).max(100),dimensions:z.object({relevance:z.number().min(0).max(100),specificity:z.number().min(0).max(100),trust:z.number().min(0).max(100),replyEase:z.number().min(0).max(100)}),summary:z.string()})).length(2),panel:z.array(z.object({persona:z.string(),vote:z.enum(["A","B"]),concern:z.string(),suggestion:z.string()})).length(4),winner:z.enum(["A","B"]),confidence:z.number().min(0).max(100)});
export async function simulateMessages(input:SimulationInput):Promise<SimulationResult>{
  const background=input.context.slice(0,1500),focusAreas=input.focusAreas.filter(Boolean).slice(0,5).map(area=>area.slice(0,120));
  const prompt=`You are running a rigorous pre-send message simulation. Compare variants A and B for ${input.personName} at ${input.company}. Channel: ${input.channel}. Signal: ${input.signalSummary}.

## Decision the team needs answered
${input.goal.slice(0,240)}

## Background the team shared (their real situation — react to the messages in this light)
${background||"No additional context."}

## The team asked the room to weigh these specifically
${focusAreas.length?focusAreas.map(area=>`- ${area}`).join("\n"):"- relevance\n- trust\n- ease of reply"}
Where relevant, aim each concern and suggestion at these lenses. Do not invent proof, relationships, results, or company facts.

## Prior observed experiment outcomes
${input.outcomeHistory||"No completed message experiments yet. Do not invent historical performance."}
Use real outcomes only as light calibration; do not let a small sample override the current prospect and signal.

## Variants
${JSON.stringify(input.variants)}

Simulate exactly four perspectives: the operator who owns the work, a busy executive, a skeptical buyer, and a message-quality/filter reviewer. Score each variant 0-100 on relevance, specificity, trust, and replyEase. Prefer concrete signal use, restraint, brevity, and a low-friction reply. Penalize generic praise, manufactured familiarity, hype, repetition, or meeting asks. This is directional qualitative judgment, never a predicted response rate.

Return JSON only: {"variants":[{"label":"A","subject":"","body":"","score":0,"dimensions":{"relevance":0,"specificity":0,"trust":0,"replyEase":0},"summary":""},{"label":"B","subject":"","body":"","score":0,"dimensions":{"relevance":0,"specificity":0,"trust":0,"replyEase":0},"summary":""}],"panel":[{"persona":"The operator","vote":"A","concern":"","suggestion":""},{"persona":"The busy executive","vote":"A","concern":"","suggestion":""},{"persona":"The skeptic","vote":"A","concern":"","suggestion":""},{"persona":"The message filter","vote":"A","concern":"","suggestion":""}],"winner":"A","confidence":0}`;
  const response=await client().messages.create({model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5",max_tokens:1800,messages:[{role:"user",content:prompt}]});
  const parsed=simulationOutput.parse(jsonFrom(text(response.content)));
  const variants=parsed.variants.map(scored=>({...scored,...input.variants.find(original=>original.label===scored.label)!}));
  return {...parsed,variants,model:process.env.ANTHROPIC_MODEL??"claude-sonnet-4-5"};
}
