import { createHash } from "node:crypto";
import { z } from "zod";
import { lintEmail } from "../../tools/email-writer/src/lint.ts";
import { COMPANY_FURNITURE } from "./draft-audit.ts";
import { firstTouchErrors } from "./first-touch.ts";

/**
 * The approved copy behind the curated batch 3 (data/batch-3-offers.json): three email versions and their
 * LinkedIn notes, filled with one researched workflow idea. Nightly lists use the same wording, so a new
 * company reads exactly like the lists Josh and Suuchi already send, and no free-form model copy goes out.
 */
export type Workflow = {
  /** Lowercase noun phrase: "branch service follow-up". */
  task: string;
  /** Two to five lowercase words for the subject: "branch follow-ups". */
  subject: string;
  /** What the tool would bring together: "site inspection notes, the promised fix and evidence that it was completed". */
  inputs: string;
  /** What would be measured: "time spent chasing updates". */
  metric: string;
};

export type ListVariant = { id: string; label: string; subject: string; message: string; linkedinMessage: string };

export function listVariants(company: string, workflow: Workflow): ListVariant[] {
  return templateVariants(company, workflow);
}

function templateVariants(company: string, workflow: Workflow): ListVariant[] {
  const { task, subject, inputs, metric } = workflow;
  return [
    {
      id: "direct-offer", label: "Direct Offer", subject,
      message: `I'm {sender} at Nine-67. Our AI engineers work alongside business and operations teams, building tools around the work they want off their plate: reports that pull themselves together, paperwork read and entered for you, and systems that share data instead of retyping it.\n\nFor ${company}, I'd start with ${task}: bringing together ${inputs}. We'd learn the process from your team, build a first version and stay through testing and training.\n\nWould help with ${task} be useful, or is another task higher on your list?`,
      linkedinMessage: `I'm {sender} at Nine-67. We put AI engineers alongside operations teams to build tools around their work. For ${company}, I'd explore ${task}. We'd build with your team and stay through testing and training. Is that something you'd like help with?`,
    },
    {
      id: "concrete-idea", label: "Concrete Idea", subject: `one AI project: ${subject}`,
      message: `For ${company}, one practical place to try AI is ${task}. We'd build a tool that brings together ${inputs}, ready for your team to check and act on.\n\nI'm {sender} at Nine-67. We build with the people doing the work and train them as we launch. We'd start with one team and measure ${metric}.\n\nIs that a useful first project to discuss?`,
      linkedinMessage: `One idea for ${company}: use AI to bring together ${inputs}. I'm {sender} at Nine-67. We'd build it with your team and measure ${metric}. Is that worth a conversation?`,
    },
    {
      id: "delivery-experience", label: "Delivery Experience", subject: "getting AI into daily use",
      message: `I'm {sender} at Nine-67. We recently helped one client deploy 20 applications, working with leaders on priorities and users on testing, training and launch.\n\nAt ${company}, I'd start smaller: ${task}. Our AI engineers would bring together ${inputs}, then test whether it reduces ${metric}. Your team would review the output.\n\nWould you be open to a short conversation about where we could help?`,
      linkedinMessage: `I'm {sender} at Nine-67. We helped one client deploy 20 applications, including user testing and training. For ${company}, I'd start with one task: ${task}. Would you be open to comparing priorities?`,
    },
  ];
}

const clean = (value: string) => value.trim().replace(/\s+/g, " ").replace(/[.;:]+$/, "");

/** The shape a researched or repaired workflow must have before checkWorkflow looks at it. */
export const workflowShape = z.object({ task: z.string(), subject: z.string(), inputs: z.string(), metric: z.string() });

export type WorkflowContext = {
  company?: string;
  domain?: string;
  /** Names grounded in the evidence (for example systems a page confirmed); they may appear capitalised. */
  allowedNames?: string[];
};

/** Generic acronyms that may appear capitalised in workflow text. */
const ACRONYMS = new Set(["AI", "CRM", "ERP", "HR", "IT", "QA"]);
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsWord = (text: string, phrase: string) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(phrase.toLowerCase())}(?:$|[^a-z0-9])`).test(text.toLowerCase());
const domainStem = (domain: string) => domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0] ?? "";

/** Free fixes for punctuation the templates cannot carry: long dashes become commas, question marks go, the subject is lowercased. */
export function normalizeWorkflow(raw: Workflow): Workflow {
  const fix = (value: string) => value.replace(/\s*[—–]+\s*/g, ", ").replace(/\?/g, "").replace(/\s+,/g, ",").replace(/,\s*$/, "");
  return { task: fix(raw.task), subject: fix(raw.subject).toLowerCase(), inputs: fix(raw.inputs), metric: fix(raw.metric) };
}

/** Normalise a researched idea, or explain why it cannot be used in the templates. */
export function checkWorkflow(raw: Workflow, context: WorkflowContext = {}): { workflow: Workflow } | { problem: string } {
  const workflow = { task: clean(raw.task).replace(/^./, (c) => c.toLowerCase()), subject: clean(raw.subject).toLowerCase(), inputs: clean(raw.inputs), metric: clean(raw.metric).replace(/^./, (c) => c.toLowerCase()) };
  const names = [context.company ?? "", context.company ? speakableCompany(context.company) : "", domainStem(context.domain ?? "")].filter((name) => name.trim().length >= 3);
  const allowed = (context.allowedNames ?? []).map((name) => name.trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const original = { task: clean(raw.task), subject: clean(raw.subject), inputs: clean(raw.inputs), metric: clean(raw.metric) };
  for (const [key, value, max] of [["task", workflow.task, 70], ["subject", workflow.subject, 40], ["inputs", workflow.inputs, 160], ["metric", workflow.metric, 70]] as const) {
    if (value.length < 4) return { problem: `workflow ${key} is missing` };
    if (value.length > max) return { problem: `workflow ${key} is too long` };
    if (/[?—–]|https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ai)\b/i.test(value)) return { problem: `workflow ${key} has a question mark, a long dash or a link` };
    // The templates are approved wording; the workflow must stay generic so nothing unverified reaches the prospect.
    if (/\d/.test(value)) return { problem: `workflow ${key} has a number` };
    if (/\b(?:your|their|our)\b/i.test(value)) return { problem: `workflow ${key} makes a claim about the company` };
    if (names.some((name) => containsWord(value, name))) return { problem: `workflow ${key} names the company` };
    // Checked on the text as written, before lowercasing, so "ServiceTitan notes" cannot hide as "serviceTitan".
    const rest = allowed.reduce((text, name) => text.replace(new RegExp(escapeRegExp(name), "gi"), " "), original[key]);
    const proper = rest.match(/[A-Za-z][A-Za-z']*/g)?.find((word, index) => /[A-Z]/.test(word) && !ACRONYMS.has(word) && !(index === 0 && rest.trimStart().startsWith(word) && /^[A-Z][a-z']*$/.test(word)));
    if (proper) return { problem: `workflow ${key} has a name or place ("${proper}")` };
  }
  if (workflow.subject.split(" ").length > 5) return { problem: "workflow subject is longer than five words" };
  return { workflow };
}

export type WorkflowAgent = (prompt: string) => Promise<unknown>;

/**
 * One repair attempt for a workflow that failed its checks, so a researched company is not thrown away
 * over wording. The agent is injected (the builder passes a cheap writing call on the company's budget).
 * Returns the repaired workflow and its variants, or the reason it still fails.
 */
export async function repairWorkflow(workflow: Workflow, problems: string[], evidenceSummary: string, agent: WorkflowAgent, context: WorkflowContext & { company: string }): Promise<{ workflow: Workflow; variants: ListVariant[] } | { problem: string }> {
  const prompt = `Rewrite this outreach workflow idea so it passes the checks below. Use only the material given here.

Current fields:
${JSON.stringify({ task: workflow.task, subject: workflow.subject, inputs: workflow.inputs, metric: workflow.metric }, null, 2)}

Problems to fix:
${problems.map((problem) => `- ${problem}`).join("\n")}

Limits:
- task: a generic lowercase noun phrase, 4 to 70 characters
- subject: 2 to 5 lowercase words, at most 40 characters
- inputs: what the tool would bring together, at most 160 characters
- metric: what would be measured, 4 to 70 characters
- No question marks, no long dashes, no links, no numbers, no "your", "their" or "our"
- No company, product, software or place names; only the acronyms AI, CRM, ERP, HR, IT or QA may be capitalised${context.allowedNames?.length ? ` (these names are also allowed: ${context.allowedNames.join(", ")})` : ""}
- The whole email must stay at or under 120 words

Evidence (for inspiration only, do not restate it):
${evidenceSummary.trim() || "none"}

Return JSON only: {"task":"","subject":"","inputs":"","metric":""}`;
  let reply: unknown;
  try {
    reply = await agent(prompt);
  } catch (error) {
    return { problem: `repair failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = workflowShape.safeParse(typeof reply === "string" ? parseJsonText(reply) : reply);
  if (!parsed.success) return { problem: "repair did not return a workflow" };
  const checked = checkWorkflow(normalizeWorkflow(parsed.data), context);
  if ("problem" in checked) return checked;
  const variants = listVariants(context.company, checked.workflow);
  const remaining = variantProblems(variants, undefined, context.company);
  if (remaining.length) return { problem: remaining.slice(0, 2).join("; ") };
  return { workflow: checked.workflow, variants };
}

function parseJsonText(text: string): unknown {
  const body = text.match(/\{[\s\S]*\}/)?.[0];
  if (!body) return null;
  try { return JSON.parse(body); } catch { return null; }
}

/** The versions that may be sent automatically. delivery-experience has the same subject for everyone, so it stays manual. */
export const AUTO_ARMS = ["direct-offer", "concrete-idea"] as const;

/** Pick the version to send by a stable hash of the domain, so arms split evenly and a company never flips between them. */
export function chooseArm(domain: string, variants: ListVariant[]): { variants: ListVariant[]; armId: string | null } {
  const arms = AUTO_ARMS.filter((id) => variants.some((variant) => variant.id === id));
  if (!arms.length) return { variants, armId: null };
  const key = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const armId = arms[createHash("sha256").update(key).digest().readUInt32BE(0) % arms.length];
  const chosen = variants.find((variant) => variant.id === armId)!;
  return { variants: [chosen, ...variants.filter((variant) => variant !== chosen)], armId };
}

const LEGAL_SUFFIX = /[\s,]+(?:inc|incorporated|llc|l\.l\.c|co|corp|corporation|ltd|plc|lp|llp)\.?$/i;
const FURNITURE_WORD = new RegExp(`^(?:${COMPANY_FURNITURE.source})$`, "i");
const isFurniture = (word: string) => FURNITURE_WORD.test(word) || !/[a-z0-9]/i.test(word);

/**
 * The name a person would say: "Acme Landscaping, LLC" reads as "Acme Landscaping". Capitalisation is never
 * changed (BELFOR stays BELFOR), and anything that would leave only generic words falls back to the original.
 */
export function speakableCompany(name: string): string {
  const original = name.trim().replace(/\s+/g, " ");
  if (!original) return "";
  let result = original;
  const dba = result.match(/\s*,?\s*\b(?:d\/b\/a|dba)\b\.?:?\s*(.*)$/i);
  if (dba) result = dba[1].trim() || result.slice(0, dba.index).trim();
  result = result.replace(/\s*\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  for (let previous = ""; previous !== result;) { previous = result; result = result.replace(LEGAL_SUFFIX, "").replace(/[\s,]+$/, "").trim(); }
  let words = result.split(" ").filter(Boolean);
  if (words.length >= 3 && /^the$/i.test(words[0])) words = words.slice(1);
  const distinctive = (list: string[]) => list.filter((word) => !isFurniture(word)).length;
  if (words.length > 1 && /^(?:holdings|group)$/i.test(words.at(-1)!) && distinctive(words.slice(0, -1)) >= 2) words = words.slice(0, -1);
  result = words.join(" ");
  if (result.length < 2 || !words.length || words.every(isFurniture)) return original;
  return result;
}

/** Every version must pass the writer-kit lint and the first-touch rules before it can go on a list. */
/** The company's own name stands in as a neutral word, so a name such as "Mainscape Landscaping" never trips a
 *  banned-word rule ("landscape" is banned as jargon) that its copy cannot be rewritten to avoid. */
const withoutName = (text: string, company: string) => {
  const name = company.trim();
  if (!name) return text;
  // One neutral word per word of the name, so the word count (and the 120-word limit) is unchanged.
  const stand = name.split(/\s+/).map(() => "Acme").join(" ");
  return text.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), stand);
};

export function variantProblems(variants: ListVariant[], sampleSender = "Josh", company = "") {
  const problems: string[] = [];
  for (const variant of variants) {
    const message = withoutName(variant.message.replaceAll("{sender}", sampleSender), company);
    const body = `Hi Pat,\n\n${message}`;
    problems.push(...firstTouchErrors(variant.subject, body).map((issue) => `${variant.id}: ${issue}`));
    const lint = lintEmail({ touch: 1, subject: variant.subject, body: message });
    if (!lint.pass) problems.push(...lint.issues.filter((issue) => issue.severity === "error").map((issue) => `${variant.id}: ${issue.rule} ${issue.detail}`));
  }
  return problems;
}
