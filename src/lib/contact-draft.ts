import { decodeEntities } from "./clean.ts";

/**
 * A first-touch email written for ONE person, from what is already on file. No model call: the angle comes
 * from what that person's role owns, and every concrete detail comes from the company's own signal.
 *
 * The desk previously held one draft per company and swapped the name on it, so three colleagues received
 * the same note with a different greeting — which reads as a mail merge the moment two of them compare.
 * Here a CFO is asked about cost per hire, an engineering leader about what gets built, and a CEO about
 * headcount, off the same evidence.
 */

export type ContactDraftInput = {
  company: string;
  personName: string;
  personTitle: string;
  /** The dated, sourced reason this company is worth writing to. */
  whyNow?: string | null;
  /** The work the company needs done, in the signal's own words. */
  operatingNeed?: string | null;
  /** Open roles that prompted the signal, most relevant first. */
  roles?: string[];
  senderName?: string | null;
  senderTitle?: string | null;
};

type Variant = {
  subject: (context: Context) => string;
  opening: (context: Context) => string;
  offer: (context: Context) => string;
  ask: string;
};

type Angle = { key: string; variants: Variant[] };

type Context = { company: string; roleList: string; roleCount: number; firstRole: string; need: string };

/** "a Data Engineer role" / "those 3 roles" — whichever reads better in a sentence. */
const roleNoun = (c: Context) => (c.roleCount > 1 ? `those ${c.roleCount} roles` : `the ${c.firstRole} role`);

/**
 * Two ways to make the same point per angle. Co-founders and a CEO share an angle — at Quantiphi there
 * are four of them — and one wording for all of them is the mail merge this feature exists to avoid.
 * The choice is a stable hash of the person's name, so a contact's draft never changes under them.
 */
const ANGLES: Array<{ test: RegExp; angle: Angle }> = [
  {
    test: /\b(cfo|chief financial|controller|treasur|vp,? finance|finance|accounting|fp&a)\b/i,
    angle: { key: "finance", variants: [
      {
        subject: (c) => `The cost of ${roleNoun(c)}`,
        opening: (c) => `I saw ${c.company} is hiring ${c.roleList}.`,
        offer: (c) => `Before that becomes salary, it is worth pricing the alternative. We build and run ${c.need}, so the output arrives without the headcount and the cost is a build rather than a permanent line on payroll.`,
        ask: "Would a rough cost comparison be useful?",
      },
      {
        subject: (c) => `${roleNoun(c).replace(/^the /, "")} vs a system`,
        opening: (c) => `I noticed ${c.roleList} open at ${c.company}.`,
        offer: (c) => `Fully loaded, roles like those run well past their salary once you count recruiting, ramp and the months the work waits. We build ${c.need} instead, once, and run it.`,
        ask: "Happy to put rough numbers side by side if that is useful.",
      },
    ] },
  },
  {
    test: /\b(cto|chief technolog|chief information officer|cio|vp,? engineering|head of engineering|engineering|architect|platform|infrastructure|devops|data engineer)\b/i,
    angle: { key: "engineering", variants: [
      {
        subject: (c) => `Building ${roleNoun(c)} instead of filling it`,
        opening: (c) => `I saw the ${c.roleList} ${c.roleCount > 1 ? "openings" : "opening"} at ${c.company}.`,
        offer: (c) => `We build ${c.need} as real infrastructure, owned end to end: scheduling, checks that fail loudly, and the dashboards on top. It is the work those roles would do, running as a system rather than maintained by hand.`,
        ask: "Happy to sketch how we would structure it. Worth a look?",
      },
      {
        subject: (c) => `${c.company}: the build behind ${roleNoun(c)}`,
        opening: (c) => `I saw ${c.company} is hiring ${c.roleList}.`,
        offer: (c) => `Most teams end up carrying this as scripts on someone's laptop until a hire lands. We build ${c.need} properly, in your stack, with the handover documented so your team owns it rather than inherits it.`,
        ask: "What does that work run on at the moment?",
      },
    ] },
  },
  {
    test: /\b(ciso|chief information security|security|risk|compliance|privacy|audit)\b/i,
    angle: { key: "security", variants: [
      {
        subject: (c) => `Data handling behind ${c.company}'s new roles`,
        opening: (c) => `I noticed ${c.company} is hiring ${c.roleList}.`,
        offer: (c) => `When this work gets stood up in a hurry it spreads across spreadsheets and personal scripts. We build ${c.need} once, with access controlled, movement logged and nothing living on a laptop.`,
        ask: "Is that worth a short conversation?",
      },
      {
        subject: (c) => `Who touches the data once ${roleNoun(c)} lands`,
        opening: (c) => `I saw ${c.roleList} open at ${c.company}.`,
        offer: (c) => `New hands on data usually means new copies of it. We build ${c.need} as one controlled path, so access is granted rather than assumed and there is a record of what moved.`,
        ask: "Would it help to see how we handle that?",
      },
    ] },
  },
  {
    test: /\b(coo|chief operating|operations|ops|supply chain|procurement|delivery|process)\b/i,
    angle: { key: "operations", variants: [
      {
        subject: (c) => `Doing that work without ${roleNoun(c)}`,
        opening: (c) => `I saw ${c.company} has ${c.roleList} open.`,
        offer: (c) => `Most of what those roles do day to day is the same few steps repeated. We automate ${c.need} so the routine part runs itself and the people you have handle the exceptions.`,
        ask: "Which of those steps eats the most time right now?",
      },
      {
        subject: (c) => `${c.company}: the repeatable half of ${roleNoun(c)}`,
        opening: (c) => `I noticed ${c.roleList} open at ${c.company}.`,
        offer: (c) => `Before hiring for all of it, it is worth splitting the work: the part that repeats and the part that needs judgement. We build and run ${c.need} so a smaller team covers the rest.`,
        ask: "Worth twenty minutes to work out where that line sits?",
      },
    ] },
  },
  {
    test: /\b(chro|chief people|people|talent|recruit|hr|human resources)\b/i,
    angle: { key: "people", variants: [
      {
        subject: (c) => `${roleNoun(c)} and time to hire`,
        opening: (c) => `I saw ${c.roleList} open at ${c.company}.`,
        offer: (c) => `Technical roles like these often sit open for months, and the work waits the whole time. We build and run ${c.need} so the output starts now, which takes pressure off the search rather than replacing it.`,
        ask: "Would it help to have that running while you hire?",
      },
      {
        subject: (c) => `Cover for ${roleNoun(c)} while you search`,
        opening: (c) => `I noticed ${c.company} is hiring ${c.roleList}.`,
        offer: (c) => `The gap between posting and a productive start is usually where the backlog builds. We stand up ${c.need} in the meantime, and it keeps working whoever you hire.`,
        ask: "Is the wait the painful part here?",
      },
    ] },
  },
  {
    test: /\b(cmo|marketing|brand|demand gen|growth|communications)\b/i,
    angle: { key: "marketing", variants: [
      {
        subject: (c) => `Reporting behind ${c.company}'s data hires`,
        opening: (c) => `I saw ${c.company} is hiring ${c.roleList}.`,
        offer: (c) => `Teams like yours usually feel that first as reporting that lands late and never quite reconciles. We build ${c.need} so the numbers arrive on a schedule, from one source.`,
        ask: "Is reporting turnaround a problem worth solving there?",
      },
      {
        subject: (c) => `Getting numbers out of ${c.company} faster`,
        opening: (c) => `I noticed ${c.roleList} open at ${c.company}.`,
        offer: (c) => `Waiting on a hire usually means waiting on the numbers too. We build ${c.need} so what you need to decide with shows up without anyone assembling it by hand.`,
        ask: "What reporting do you chase most often?",
      },
    ] },
  },
  {
    test: /\b(ceo|founder|co-founder|president|owner|managing director|chief executive)\b/i,
    angle: { key: "executive", variants: [
      {
        subject: (c) => `${roleNoun(c).replace(/^the /, "").replace(/^those /, "")}, or a system`,
        opening: (c) => `I saw ${c.company} has ${c.roleList} open.`,
        offer: (c) => `That is a permanent cost for work that mostly repeats. We build and run ${c.need} instead, so the output arrives without growing the team, and the decision stays reversible.`,
        ask: "Worth twenty minutes to compare the two?",
      },
      {
        subject: (c) => `Before ${c.company} fills ${roleNoun(c)}`,
        opening: (c) => `I noticed ${c.roleList} open at ${c.company}.`,
        offer: (c) => `Hiring is the obvious answer and it is not always the cheaper one. We build ${c.need} as a system you own, which costs a build rather than a payroll line and can be undone if it does not earn its place.`,
        ask: "Would it be useful to see what that looks like for you?",
      },
    ] },
  },
];

const FALLBACK: Angle = { key: "general", variants: [
  {
    subject: (c) => `${c.firstRole} at ${c.company}`,
    opening: (c) => `I saw ${c.company} is hiring ${c.roleList}.`,
    offer: (c) => `We build and run ${c.need}, so that work gets done as a system rather than a hire.`,
    ask: "Is that worth a short conversation?",
  },
  {
    subject: (c) => `${c.company} and ${roleNoun(c)}`,
    opening: (c) => `I noticed ${c.roleList} open at ${c.company}.`,
    offer: (c) => `We build ${c.need} and run it, so the output starts without waiting on a hire.`,
    ask: "Happy to explain how that works if it is useful.",
  },
] };

/** Which angle a title gets. Exported so the choice can be tested directly. */
export function angleFor(title: string): string {
  const clean = decodeEntities(title);
  return (ANGLES.find((entry) => entry.test.test(clean))?.angle ?? FALLBACK).key;
}


/**
 * A grammatical noun phrase for the work, derived from the roles being hired.
 *
 * This used to be sliced out of the signal's own prose, which produced "We build and run the that work
 * instead of adding headcount". A phrase built from the roles is always a phrase, and still specific
 * because the roles are.
 */
function needPhrase(roles: string[], operatingNeed?: string | null): string {
  const text = `${roles.join(" ")} ${decodeEntities(operatingNeed ?? "")}`.toLowerCase();
  if (/financ|account|revenue|invoic/.test(text)) return "the financial reporting and the reconciliation under it";
  if (/report/.test(text) && /data|pipeline|etl|warehouse|dbt|snowflake/.test(text)) return "the pipelines and the reporting they feed";
  if (/pipeline|etl|warehouse|dbt|snowflake|data engineer/.test(text)) return "the data pipelines and the checks that keep them honest";
  if (/analy/.test(text)) return "the analysis and the reporting around it";
  if (/market|campaign|attribution/.test(text)) return "the campaign reporting and the attribution behind it";
  if (/support|ticket|service desk|helpdesk/.test(text)) return "the triage and the reporting on it";
  if (/secur|complian|audit|risk/.test(text)) return "the evidence gathering and the reporting on it";
  if (/report/.test(text)) return "the reporting and the data work behind it";
  return "the reporting and data work";
}

/** A stable 0..n-1 choice per person, so the same contact always gets the same wording. */
function variantFor(seed: string, count: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return count > 0 ? hash % count : 0;
}

const firstNameOf = (name: string) => decodeEntities(name).trim().split(/\s+/)[0] || "there";

/** Tidy a role title enough to sit inside a sentence. */
function readableRoles(roles: string[]): { list: string; first: string; count: number } {
  const cleaned = [...new Set(roles.map((role) => decodeEntities(role).replace(/\s*[-–—]\s*(USA|US|Remote|Hybrid|Onsite).*$/i, "").trim()).filter(Boolean))];
  const count = cleaned.length;
  if (!count) return { list: "for data and reporting work", first: "that role", count: 0 };
  if (count === 1) return { list: `a ${cleaned[0]}`, first: cleaned[0], count: 1 };
  if (count === 2) return { list: `a ${cleaned[0]} and a ${cleaned[1]}`, first: cleaned[0], count: 2 };
  return { list: `${count} roles including ${cleaned[0]} and ${cleaned[1]}`, first: cleaned[0], count };
}

export function composeContactDraft(input: ContactDraftInput): { subject: string; body: string } {
  const company = decodeEntities(input.company).trim() || "your team";
  const first = firstNameOf(input.personName);
  const roles = readableRoles(input.roles ?? []);
  const need = needPhrase(input.roles ?? [], input.operatingNeed);
  const context: Context = { company, roleList: roles.list, roleCount: roles.count, firstRole: roles.first, need };

  const angle = ANGLES.find((entry) => entry.test.test(decodeEntities(input.personTitle)))?.angle ?? FALLBACK;
  const variant = angle.variants[variantFor(`${input.personName}|${angle.key}`, angle.variants.length)];
  const senderName = decodeEntities(input.senderName ?? "").trim();
  const senderTitle = decodeEntities(input.senderTitle ?? "").trim();
  const intro = senderName
    ? `I am ${senderName}${senderTitle ? `, ${senderTitle}` : ""} at Nine-67.`
    : "I am with Nine-67.";

  const body = [
    `Hi ${first},`,
    "",
    `${intro} ${variant.opening(context)}`,
    "",
    variant.offer(context),
    "",
    variant.ask,
    "",
    "Thank you,",
  ].join("\n");

  // A subject built from a role phrase can start lowercase ("those 3 roles vs a system").
  const subject = variant.subject(context).slice(0, 120).replace(/^[a-z]/, (char) => char.toUpperCase());
  return { subject, body };
}
