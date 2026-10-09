/** A discovery-call prep brief, assembled from what Night Watch already knows: no model needed. */
export type BriefInput = {
  person: { full_name: string; title: string; email: string | null; linkedin_url: string | null };
  account: { name: string; domain: string; vertical: string | null; employees: string | null };
  whyNow: string;
  operatingNeed: string | null;
  roles: string[];
  posts: Array<{ author: string; topic: string }>;
  emailSubject: string | null;
  emailBody: string | null;
  meetingAt: string | null;
  history: Array<{ channel: string; at: string; replied: boolean; replyClass?: string | null; bounced?: boolean }>;
  /** The researched list row, when the company came from a list: the richest source there is. */
  research?: {
    sector?: string | null;
    sizeLabel?: string | null;
    workflow?: string | null;
    trigger?: { fact?: string | null; sourceUrl?: string | null } | null;
    reasons?: Array<{ text: string; url: string | null }>;
    limitations?: string[];
  } | null;
};
export type BriefSource = { text: string; url: string | null };
export type CallBrief = {
  who: string;
  role: string;
  company: string;
  facts: string[];
  /** Plain status: where the conversation stands. */
  status: string;
  why: BriefSource[];
  workflow: string | null;
  sentSubject: string | null;
  sentBody: string | null;
  meetingAt: string | null;
  discovery: string[];
  talkingPoints: string[];
  unknowns: string[];
  history: Array<{ label: string; at: string; outcome: string }>;
};

const CHANNEL_LABEL: Record<string, string> = { email: "Email", linkedin_message: "LinkedIn message", linkedin_comment: "LinkedIn reply", linkedin_request: "LinkedIn request", intro_ask: "Intro" };
const REPLY_LABEL: Record<string, string> = { positive: "replied, interested", referral: "replied with a referral", neutral: "replied", objection: "replied with an objection", negative: "replied, not interested", ooo: "auto-reply (out of office)" };
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

/**
 * The research writes a workflow as "Proposed workflow: X. Internal need and buying intent are not
 * confirmed." The caveat belongs in "What we don't know yet", never inside a question to ask.
 */
export function cleanWorkflow(text: string | null | undefined): string | null {
  const sentences = (text ?? "").replace(/^proposed (?:workflow|area to explore):\s*/i, "").split(/(?<=\.)\s+/)
    .filter((sentence) => !/not (?:a )?confirmed|outreach idea|not established|buying intent/i.test(sentence));
  const value = sentences.join(" ").trim().replace(/\.$/, "");
  return value || null;
}

export function buildCallBrief(input: BriefInput): CallBrief {
  const company = input.account.name;
  const research = input.research ?? null;
  const workflow = cleanWorkflow(research?.workflow) ?? cleanWorkflow(input.operatingNeed);
  const roleLine = input.roles.length ? `Hiring: ${input.roles.slice(0, 3).join(", ")}${input.roles.length > 3 ? ` +${input.roles.length - 3} more` : ""}` : null;

  const facts = [research?.sector ?? input.account.vertical, research?.sizeLabel ?? input.account.employees, roleLine]
    .filter((fact): fact is string => Boolean(fact && fact.trim() && !/^operating business$/i.test(fact.trim())));

  // Why them: the fit evidence with its sources, then the trigger, then whatever the card says.
  const why: BriefSource[] = (research?.reasons ?? []).slice(0, 4).map((reason) => ({ text: reason.text, url: reason.url }));
  if (!why.length && research?.trigger?.fact) why.push({ text: research.trigger.fact.replace(/\s*Proposed area to explore:.*$/i, ""), url: research.trigger.sourceUrl ?? null });
  if (!why.length && input.whyNow.trim()) why.push({ text: input.whyNow.trim(), url: null });

  const first = input.person.full_name.split(/\s+/)[0] || input.person.full_name;
  // Quoted, because the idea is sometimes a noun ("progress claims") and sometimes a verb ("turn field progress into…").
  const topic = workflow ? `“${workflow}”` : "the work their team does by hand";
  const discovery = [
    ...(input.roles.length ? [`You're hiring a ${input.roles[0]}. What will that person spend most of their week on?`] : []),
    `Walk me through how your team handles ${topic} today: who does it, and in which tools?`,
    "Where does it slow down or go wrong most often?",
    "Roughly how much of the team's week goes into it?",
    "If it ran cleanly, what would the team spend that time on instead?",
    "Who else would need to be involved to try a first version?",
  ];
  const talkingPoints = [
    "Nine-67 is an AI-first company. Our forward-deployed engineers work alongside the people doing the work and build custom software around it.",
    `Start small: one workflow${workflow ? ` (${workflow})` : ""}, a first version the team can test on real work, then training and rollout.`,
    `Ask about ${topic}; don't assume it is a problem for them. Let ${first} tell you where the pain is.`,
    "Goal for the call: agree on one workflow to scope, who owns it, and a next step with a date.",
  ];

  const sent = input.history.filter((touch) => touch.channel === "email");
  const replied = sent.find((touch) => touch.replied && touch.replyClass && touch.replyClass !== "ooo" && touch.replyClass !== "none");
  const status = input.meetingAt ? `Meeting booked for ${new Date(input.meetingAt).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" })} Eastern.`
    : replied ? `${first} ${REPLY_LABEL[replied.replyClass ?? ""] ?? "replied"} on ${day(replied.at)}.`
    : sent.length ? `Emailed ${sent.length === 1 ? "once" : `${sent.length} times`}, last on ${day(sent.at(-1)!.at)}. No reply yet.`
    : "Not emailed yet.";

  const unknowns = (research?.limitations ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  if (!unknowns.length) unknowns.push("Whether this workflow is a real problem for them, and whether there is budget, has not been confirmed.");

  return {
    who: input.person.full_name,
    role: input.person.title || "Title not known",
    company,
    facts,
    status,
    why,
    workflow,
    sentSubject: input.emailSubject,
    sentBody: input.emailBody,
    meetingAt: input.meetingAt,
    discovery,
    talkingPoints,
    unknowns,
    history: input.history.map((touch) => ({
      label: CHANNEL_LABEL[touch.channel] ?? touch.channel, at: touch.at,
      outcome: touch.bounced ? "bounced" : touch.replied ? REPLY_LABEL[touch.replyClass ?? ""] ?? "replied" : "no reply yet",
    })),
  };
}
