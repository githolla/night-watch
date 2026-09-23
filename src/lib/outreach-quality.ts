/** Deterministic checks run on raw model output, before punctuation cleanup. */
export type OutreachQualityContext = { requireIntroduction?: boolean; reframe?: string; senderName?: string; signature?: string; avoid?: string[]; subjectIdeas?: string[]; cta?: string };
const stopWords = new Set("a an the and or but if then than of to in on at by for from with as is are was were be been being it its this that these those they their them we our you your i me my how what which who when where why can could would should may might will do does did not no only one more most very new still just into about has have had also up out so before after".split(" "));
export function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => word.length > 2 && !stopWords.has(word)));
}
export function outreachQualityFailures(body: string, context: OutreachQualityContext = {}, subject = ""): string[] {
  const failures: string[] = [];
  if (context.requireIntroduction && !/Nine-67[^.!?\n]{0,100}\bbuild(?:s)? custom software\b/i.test(body)) failures.push("Introduce Nine-67 as a team that builds custom software; a brand name or signature alone is not an introduction.");
  if (/[\u2013\u2014]/u.test(body + subject)) failures.push("Never use em or en dashes.");
  if (context.reframe) {
    const words = contentWords(body);
    if ([...contentWords(context.reframe)].filter(word => words.has(word)).length < 3) failures.push("Insert pain_hypothesis.reframe as sentence 2 or 3, retaining at least three of its content words.");
  }
  const lines = body.trim().split(/\n/).map(line => line.trim()).filter(Boolean);
  const questionIndex = lines.findIndex(line => line.includes("?"));
  if (questionIndex < 0) failures.push("End the body with the CTA question.");
  else {
    const questionLine = lines[questionIndex];
    const suffix = questionLine.slice(questionLine.indexOf("?") + 1).trim();
    const allowed = new Set([context.senderName, context.senderName?.trim().split(/\s+/)[0], ...(context.signature?.split(/\n/).map(line => line.trim()) ?? [])].filter(Boolean));
    if (suffix || lines.slice(questionIndex + 1).some(line => !allowed.has(line))) failures.push("Delete everything after the CTA except the sender name/signature block.");
  }
  return failures;
}

/** Three attempts total: initial generation plus at most two corrective retries. */
export async function generateCheckedOutreach<T extends { body: string; subject?: string }>(
  generate: (feedback: string, attempt: number) => Promise<T>,
  context: OutreachQualityContext,
  critic?: (draft: T) => Promise<string[]>,
): Promise<T> {
  let failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const draft = await generate(failures.length ? `The previous draft was rejected. Fix all failures: ${failures.join(" ")}` : "", attempt);
    failures = outreachQualityFailures(draft.body, context, draft.subject);
    if (!failures.length && critic) failures = await critic(draft);
    if (!failures.length) return draft;
  }
  throw new Error(`Draft rejected after three attempts: ${failures.join(" ")}`);
}

export const REQUIRED_WRITER_BEATS = `
Required beats (touch 1):
1. Implication opener: what the situation likely costs them. Plain words, one idea per sentence. No "I noticed".
2. Reframe: use pain_hypothesis.reframe, paraphrased to fit. Mandatory when supplied. Retain at least three content words. If it references a public statement, attribute it by name.
3. Introduce Nine-67 in one plain sentence as a team that builds custom software with operating teams. The recipient has never heard of us. Add one relevant verified proof point only when it fits; do not imply experience in their industry from a different industry case. Explain training and deployment when there is no relevant proof. What we'd build: start with "We'd build" or "We build", never "Nine-67 could". One concrete workflow plus how we'd measure it.
4. CTA: one direct, company-specific question about the proposed workflow. Use email_guidance.touch_1_cta as context, but replace negative phrasing such as "Would it be a bad idea" with a natural question. It is the last line of the body.
Keep the body around 90-115 words, at most 120, excluding greeting and sender name. State company facts accurately and pain as a hypothesis. Do not promise results, assume familiarity, or demand a meeting.
Ending: End the body with the CTA question. No Thank you, Thanks, Best, Regards or other pleasantry. The app appends the sender's first name.
Subject: Use one of email_guidance.subject_ideas when supplied, lowercase except proper nouns.
Hard constraints: Treat every item in email_guidance.avoid as a rule. Never use em or en dashes.`;
export const REQUIRED_CRITIC_RUBRIC = `
Cold introduction (auto-reject): Nine-67 must be described as building custom software, in a sentence a stranger can understand. A brand mention or signature alone fails. Verify proof relevance and do not imply sector experience or outcomes not in the evidence.
Reframe present (15 pts): email contains the idea in pain_hypothesis.reframe. Missing = score 0 and failure {criterion:"reframe", fix:"Insert pain_hypothesis.reframe as sentence 2 or 3"}.
Clean ending (auto-reject): text after CTA question other than sender name = reject, fix:"Delete everything after the CTA except the name".
Avoid list (auto-reject): any violation of email_guidance.avoid = reject, naming the violated item.
Return JSON {"pass": boolean, "failures": [{"criterion": string, "fix": string}]}. Judge the meaning of every avoid item, not just literal phrase matches. Do not invent restrictions.`;
