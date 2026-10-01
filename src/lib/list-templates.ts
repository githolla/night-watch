import { lintEmail } from "../../tools/email-writer/src/lint.ts";
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
  const { task, subject, inputs, metric } = workflow;
  return [
    {
      id: "direct-offer", label: "Direct Offer", subject,
      message: `I'm {sender} at Nine-67. Our AI engineers work alongside business and operations teams, building tools around the work they want off their plate.\n\nFor ${company}, I'd start with ${task}: bringing together ${inputs}. We'd learn the process from your team, build a first version and stay through testing and training.\n\nWould help with ${task} be useful, or is another task higher on your list?`,
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

/** Normalise a researched idea, or explain why it cannot be used in the templates. */
export function checkWorkflow(raw: Workflow): { workflow: Workflow } | { problem: string } {
  const workflow = { task: clean(raw.task).replace(/^./, (c) => c.toLowerCase()), subject: clean(raw.subject).toLowerCase(), inputs: clean(raw.inputs), metric: clean(raw.metric).replace(/^./, (c) => c.toLowerCase()) };
  for (const [key, value, max] of [["task", workflow.task, 70], ["subject", workflow.subject, 40], ["inputs", workflow.inputs, 160], ["metric", workflow.metric, 70]] as const) {
    if (value.length < 4) return { problem: `workflow ${key} is missing` };
    if (value.length > max) return { problem: `workflow ${key} is too long` };
    if (/[?—–]|https?:|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|co|ai)\b/i.test(value)) return { problem: `workflow ${key} has a question mark, a long dash or a link` };
  }
  if (workflow.subject.split(" ").length > 5) return { problem: "workflow subject is longer than five words" };
  return { workflow };
}

/** Every version must pass the writer-kit lint and the first-touch rules before it can go on a list. */
export function variantProblems(variants: ListVariant[], sampleSender = "Josh") {
  const problems: string[] = [];
  for (const variant of variants) {
    const body = `Hi Pat,\n\n${variant.message.replaceAll("{sender}", sampleSender)}`;
    problems.push(...firstTouchErrors(variant.subject, body).map((issue) => `${variant.id}: ${issue}`));
    const lint = lintEmail({ touch: 1, subject: variant.subject, body: variant.message.replaceAll("{sender}", sampleSender) });
    if (!lint.pass) problems.push(...lint.issues.filter((issue) => issue.severity === "error").map((issue) => `${variant.id}: ${issue.rule} ${issue.detail}`));
  }
  return problems;
}
