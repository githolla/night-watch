/** A discovery-call prep brief, assembled from what Night Watch already knows — no model needed. */
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
  history: Array<{ channel: string; at: string; replied: boolean }>;
};
export type CallBrief = {
  who: string;
  role: string;
  company: string;
  facts: string[];
  whyNow: string;
  build: string | null;
  proposed: string | null;
  meetingAt: string | null;
  discovery: string[];
  talkingPoints: string[];
  history: Array<{ label: string; at: string; replied: boolean }>;
};

const first = (name: string) => name.split(/\s+/)[0] || name;
const CHANNEL_LABEL: Record<string, string> = { email: "Email", linkedin_message: "LinkedIn message", linkedin_comment: "LinkedIn reply", linkedin_request: "LinkedIn request", intro_ask: "Intro" };

export function buildCallBrief(input: BriefInput): CallBrief {
  const company = input.account.name;
  const need = input.operatingNeed?.trim() || null;
  const roleLine = input.roles.length ? `Hiring for ${input.roles.slice(0, 3).join(", ")}${input.roles.length > 3 ? ` +${input.roles.length - 3} more` : ""}` : null;

  const facts = [
    input.account.vertical,
    input.account.employees,
    roleLine,
    input.posts.length ? `${input.posts.length} employee AI post${input.posts.length === 1 ? "" : "s"} on file` : null,
  ].filter(Boolean) as string[];

  // Discovery questions grounded in the specific need/role — what to actually probe on the call.
  const discovery: string[] = [];
  if (input.roles.length) discovery.push(`You've got ${input.roles[0]} open — what does that person spend most of their week actually doing?`);
  if (need) discovery.push(`How is that handled today — ${need.replace(/\.$/, "")} — manual, a tool, or a mix?`);
  discovery.push("Where does that work create the most drag — speed, errors, or the cost of the headcount?");
  discovery.push("If that workflow ran itself, what would it free the team up to do instead?");
  discovery.push("Who owns this internally, and who else would need to be in the room to move on it?");
  discovery.push("What's the cost of leaving it as-is for another couple of quarters?");

  const talkingPoints = [
    `Nine-67 builds and runs the work instead of adding headcount — for ${company}, that's the ${need ? need.replace(/\.$/, "") : "operating work behind these roles"}.`,
    "Position it as an internal system that owns the workflow end to end, not a tool they have to staff and babysit.",
    "Anchor on the specific signal that opened the conversation — keep it concrete, not a generic AI pitch.",
    "Aim to leave with one workflow to scope and a follow-up with the right owner.",
  ];

  return {
    who: input.person.full_name,
    role: input.person.title || "title unknown",
    company,
    facts,
    whyNow: input.whyNow || `${company} has operating work Nine-67 could build and run.`,
    build: need,
    proposed: input.emailSubject ? `Opening angle sent: “${input.emailSubject}”` : null,
    meetingAt: input.meetingAt,
    discovery,
    talkingPoints,
    history: input.history.map((h) => ({ label: CHANNEL_LABEL[h.channel] ?? h.channel, at: h.at, replied: h.replied })),
  };
}

export { first as briefFirstName };
