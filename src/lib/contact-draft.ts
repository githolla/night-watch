import { decodeEntities } from "./clean.ts";

/**
 * A first-touch email written for ONE person, from what is already on file. No model call: the angle comes
 * from what that person's role owns, the specifics from the roles the company has open.
 *
 * One draft per company with the name swapped reads as a mail merge the moment two colleagues compare, so a
 * CFO is asked about cost, an engineering leader about what gets built, a CEO about growing the team.
 *
 * Grammar is assembled, not interpolated. An earlier version built sentences by dropping a phrase into a
 * slot ("the ${roleList}") and produced "I saw the a Data Engineer opening", "a Audit Data Analyst",
 * "that role role", and plural copy about a single role — on roughly a third of drafts. Every phrase here
 * therefore carries its own article and number, and the templates never prepend one.
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

type Context = {
  company: string;
  /** What they are hiring, ready to follow "I saw X is hiring …": "a Data Engineer role", "three roles, A and B". */
  hiring: string;
  /** How to refer back to it: "the Data Engineer role", "those three roles", "that work". */
  noun: string;
  /** The same, safe to start a clause: no leading article. */
  bareNoun: string;
  /** "it" / "them" */
  pronoun: string;
  /** "that role does" / "those roles do" */
  rolesDo: string;
  count: number;
  /** What we would build, as a noun phrase carrying its own article. */
  need: string;
  /** True only for two or more roles. Zero roles reads as singular ("that work"), never plural. */
  isPlural: boolean;
  /** Complete opening sentences, grammatical at every role count. */
  sawLine: string;
  noticedLine: string;
};

type Variant = {
  subject: (c: Context) => string;
  opening: (c: Context) => string;
  offer: (c: Context) => string;
  ask: (c: Context) => string;
};

type Angle = { key: string; variants: Variant[] };

/**
 * Titles are matched as PREFIXES, not whole words. The previous table wrapped stems in \b…\b, so
 * "chief technolog" matched nothing in "Chief Technology Officer" (125 mentions on the list fell through to
 * the generic angle), and "treasur" missed "Treasurer", "recruit" missed "Recruiter".
 */
const ANGLES: Array<{ test: RegExp; angle: Angle }> = [
  {
    // Money. Checked before technology so "VP, Finance Transformation" is finance, not transformation.
    test: /\b(cfo|chief financial\w*|controller\w*|treasur\w*|finance\w*|financial\w*|accounting|fp&a|chief accounting\w*)\b/i,
    angle: { key: "finance", variants: [
      {
        subject: (c) => `${c.company}: the cost of ${c.bareNoun}`,
        opening: (c) => c.sawLine,
        offer: (c) => `Before that becomes salary it is worth pricing the alternative. We build and run ${c.need}, so the output arrives without the headcount and the cost is a build rather than a permanent line on payroll.`,
        ask: () => "Would a rough cost comparison be useful?",
      },
      {
        subject: (c) => `${c.bareNoun} at ${c.company}, or a system`,
        opening: (c) => c.noticedLine,
        offer: (c) => `Fully loaded, a role like that runs well past its salary once recruiting, ramp and the months of waiting are counted. We build ${c.need} once instead, and run it.`,
        ask: () => "Happy to put rough numbers side by side if that helps.",
      },
    ] },
  },
  {
    // Whoever owns what gets built.
    test: /\b(cto|chief technolog\w*|chief information officer|cio|chief digital\w*|chief data\w*|chief analytics\w*|chief ai\w*|chief innovation\w*|chief knowledge\w*|chief product\w*|engineering|engineer|architect\w*|platform\w*|infrastructure|devops|technolog\w*|technical|digital|ecommerce|e-commerce|data|analytics|bi\b|business intelligence|it\b|information technology|software|cloud|product)\b/i,
    angle: { key: "engineering", variants: [
      {
        subject: (c) => `${c.company}: building ${c.bareNoun} instead of filling ${c.pronoun}`,
        opening: (c) => c.sawLine,
        offer: (c) => `We build ${c.need} as real infrastructure, owned end to end: scheduling, checks that fail loudly, and the reporting on top. That is the work the postings describe, running as a system rather than maintained by hand.`,
        ask: () => "Happy to sketch how we would structure it. Worth a look?",
      },
      {
        subject: (c) => `The build behind ${possessive(c.company)} open ${c.isPlural ? "roles" : "role"}`,
        opening: (c) => c.noticedLine,
        offer: (c) => `We build ${c.need} and hand it over documented, so it is something your team owns rather than inherits. It runs whether or not the hire lands.`,
        ask: () => "What does that work run on at the moment?",
      },
    ] },
  },
  {
    test: /\b(ciso|chief information security\w*|chief security\w*|security|infosec|cyber\w*|risk|compliance|privacy|audit|chief claims\w*)\b/i,
    angle: { key: "security", variants: [
      {
        subject: (c) => c.count
          ? `${c.company}: who touches the data once ${c.bareNoun} ${c.isPlural ? "are" : "is"} filled`
          : `${c.company}: who touches the data as the team grows`,
        opening: (c) => c.noticedLine,
        offer: (c) => `New hands on data usually means new copies of it. We build ${c.need} as one controlled path, so access is granted rather than assumed and there is a record of what moved.`,
        ask: () => "Is that worth a short conversation?",
      },
      {
        subject: (c) => `Data handling behind ${possessive(c.company)} new ${c.isPlural ? "roles" : "role"}`,
        opening: (c) => c.sawLine,
        offer: (c) => `Work stood up in a hurry tends to end up spread across spreadsheets and personal exports. We build ${c.need} once, in one place, with access controlled and movement logged.`,
        ask: () => "Would it help to see how we handle that?",
      },
    ] },
  },
  {
    test: /\b(coo|chief operating\w*|operations|operational|ops|supply chain|procurement|logistics|delivery|process|plant|manufactur\w*|merchandis\w*|managed services|service delivery|fulfilment|fulfillment)\b/i,
    angle: { key: "operations", variants: [
      {
        subject: (c) => `${c.company}: the repeatable half of ${c.bareNoun}`,
        opening: (c) => c.sawLine,
        offer: (c) => `Work like this usually splits in two: the part that repeats and the part that needs judgement. We build and run ${c.need} so a smaller team covers the rest.`,
        ask: () => "Worth twenty minutes to work out where that line sits?",
      },
      {
        subject: (c) => `Covering ${c.bareNoun} at ${c.company}`,
        opening: (c) => c.noticedLine,
        offer: (c) => `We build ${c.need} so the routine part runs itself and the people you already have handle the exceptions.`,
        ask: () => "Which part of that eats the most time right now?",
      },
    ] },
  },
  {
    test: /\b(chro|chief people\w*|chief human\w*|people|talent|recruit\w*|hr\b|human resources|staffing|workforce)\b/i,
    angle: { key: "people", variants: [
      {
        subject: (c) => `${c.company}: cover for ${c.bareNoun} while you search`,
        opening: (c) => c.sawLine,
        offer: (c) => `The gap between posting and a productive start is usually where the backlog builds. We stand up ${c.need} in the meantime, and it keeps working whoever you hire.`,
        ask: () => "Is the wait the painful part here?",
      },
      {
        subject: (c) => `${c.bareNoun} and time to hire at ${c.company}`,
        opening: (c) => c.noticedLine,
        offer: (c) => `Technical roles like these often sit open for months and the work waits the whole time. We build and run ${c.need} so the output starts now, which takes pressure off the search rather than replacing it.`,
        ask: () => "Would it help to have that running while you hire?",
      },
    ] },
  },
  {
    test: /\b(cmo|marketing|brand|demand gen\w*|growth|communications|media|advertis\w*)\b/i,
    angle: { key: "marketing", variants: [
      {
        subject: (c) => `Getting numbers out of ${c.company} faster`,
        opening: (c) => c.noticedLine,
        offer: (c) => `Waiting on a hire usually means waiting on the numbers too. We build ${c.need} so what you need to decide with shows up without anyone assembling it by hand.`,
        ask: () => "What reporting do you chase most often?",
      },
      {
        subject: (c) => `${c.company}: reporting behind ${c.bareNoun}`,
        opening: (c) => c.sawLine,
        offer: (c) => `Teams often feel this first as reporting that lands late and never quite reconciles. We build ${c.need} so the numbers arrive on a schedule, from one source.`,
        ask: () => "Is reporting turnaround a problem worth solving there?",
      },
    ] },
  },
  {
    // Anyone senior enough to weigh a hire against a build. Last, so a more specific angle wins first.
    test: /\b(ceo|chief executive\w*|founder|co-founder|president|owner|managing partner|managing director|executive director|operating partner|value creation\w*|partner|principal|chief of staff|general manager|gm\b|cpo|chief strategy\w*|chief revenue\w*|cro|chief commercial\w*|chief transformation\w*|board|vp sales|sales)\b/i,
    angle: { key: "executive", variants: [
      {
        subject: (c) => `${c.company}: ${c.bareNoun}, or a system`,
        opening: (c) => c.sawLine,
        offer: (c) => `That is a permanent cost for work that largely repeats. We build and run ${c.need} instead, so the output arrives without growing the team, and the decision stays reversible.`,
        ask: () => "Worth twenty minutes to compare the two?",
      },
      {
        subject: (c) => `Before ${c.company} fills ${c.bareNoun}`,
        opening: (c) => c.noticedLine,
        offer: (c) => `Hiring is the obvious answer and not always the cheaper one. We build ${c.need} as a system you own, which costs a build rather than a payroll line and can be undone if it does not earn its place.`,
        ask: () => "Would it be useful to see what that looks like for you?",
      },
    ] },
  },
];

const FALLBACK: Angle = { key: "general", variants: [
  {
    subject: (c) => `${c.company} and ${c.bareNoun}`,
    opening: (c) => c.sawLine,
    offer: (c) => `We build and run ${c.need}, so that work gets done as a system rather than a hire. It runs on a schedule, from one source, and your team owns it.`,
    ask: () => "Is that worth a short conversation?",
  },
  {
    subject: (c) => `${c.company}: ${c.bareNoun} without the hire`,
    opening: (c) => c.noticedLine,
    offer: (c) => `We build ${c.need} and run it, so the output starts without waiting on a hire, and keeps working once one lands.`,
    ask: () => "Happy to explain how that works if it is useful.",
  },
] };

/** Which angle a title gets. Exported so the choice can be tested directly. */
export function angleFor(title: string): string {
  const clean = decodeEntities(title);
  return (ANGLES.find((entry) => entry.test.test(clean))?.angle ?? FALLBACK).key;
}

/** "a" or "an", by how the word is said rather than merely spelled. */
function article(word: string): string {
  const first = word.trim().replace(/^[^A-Za-z]+/, "");
  if (!first) return "a";
  // Initialisms said letter by letter: an SDR, an ML Engineer, an IT Manager.
  if (/^[A-Z]{2,}\b/.test(first) && /^[AEFHILMNORSX]/.test(first)) return "an";
  if (/^(u[bcgkmnprst]|uni|use|user|usu|euro|one|once)/i.test(first)) return "a";
  if (/^(hon|hour|heir)/i.test(first)) return "an";
  return /^[aeiou]/i.test(first) ? "an" : "a";
}

const COUNT_WORD = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (count: number) => COUNT_WORD[count] ?? String(count);

/**
 * A posting title trimmed to something that reads inside a sentence: no parenthetical, no location or
 * employment-type tail, no trailing requisition code. A subject line built from an untrimmed title was being
 * cut mid-word at 120 characters.
 */
function tidyRole(raw: string): string {
  let role = decodeEntities(raw)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s*[-–—|,]\s*(remote|hybrid|onsite|on-site|full[- ]time|part[- ]time|contract|temporary|permanent|usa?|u\.s\.?|uk|canada|emea|apac|anywhere|multiple locations)\b.*$/i, "")
    .replace(/\s*[-–—|]\s*[A-Z][a-z]+(?:[ ,]+[A-Z]{2})?\s*$/, "")
    .replace(/\s*[-–—|]?\s*\b(req|requisition|job)\s*#?\s*\d+\b.*$/i, "")
    .replace(/[\s,;:.\-–—|]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  // Still long? Cut on a word boundary, never mid-word.
  if (role.length > 44) {
    const cut = role.slice(0, 44);
    role = cut.slice(0, cut.lastIndexOf(" ") > 12 ? cut.lastIndexOf(" ") : 44).replace(/[\s,;:.-]+$/, "");
  }
  return role;
}

// A req we should not price as headcount: an internship is not a hire being weighed against a build, and
// pitching "we automate that" about a recruiter to the person hiring the recruiter contradicts itself.
const NOT_A_HEADCOUNT_DECISION = /\b(intern|internship|apprentice|co-?op|graduate programme|summer analyst|volunteer)\b/i;

function usableRoles(roles: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of roles) {
    if (NOT_A_HEADCOUNT_DECISION.test(decodeEntities(raw))) continue;
    const role = tidyRole(raw);
    if (!role || role.length < 3) continue;
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(role);
  }
  return out;
}

/** Every role phrase the templates need, each already carrying its own article and number. */
function roleContext(roles: string[]): Pick<Context, "hiring" | "noun" | "bareNoun" | "pronoun" | "rolesDo" | "count"> {
  const list = usableRoles(roles);
  const count = list.length;
  if (count === 0) {
    // No role titles on file. Never substitute a placeholder into a slot built for a noun phrase — that is
    // what produced "the that role role" and "has for data and reporting work open".
    return { hiring: "in data and reporting", noun: "that work", bareNoun: "that work", pronoun: "it", rolesDo: "that work needs", count: 0 };
  }
  if (count === 1) {
    const role = list[0];
    return {
      hiring: `${article(role)} ${role} role`,
      noun: `the ${role} role`,
      bareNoun: `the ${role} role`,
      pronoun: "it",
      rolesDo: "that role does",
      count: 1,
    };
  }
  const named = list.slice(0, 2).join(" and ");
  return {
    hiring: count === 2 ? `two roles, ${named}` : `${numberWord(count)} roles, including ${named}`,
    noun: `those ${numberWord(count)} roles`,
    bareNoun: `those ${numberWord(count)} roles`,
    pronoun: "them",
    rolesDo: "those roles do",
    count,
  };
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
  if (/financ|account|revenue|invoic|billing|payroll/.test(text)) return "the financial reporting and the reconciliation under it";
  if (/report/.test(text) && /data|pipeline|etl|warehouse|dbt|snowflake/.test(text)) return "the pipelines and the reporting they feed";
  if (/pipeline|etl|warehouse|dbt|snowflake|data engineer/.test(text)) return "the data pipelines and the checks that keep them honest";
  if (/analy/.test(text)) return "the analysis and the reporting around it";
  if (/market|campaign|attribution/.test(text)) return "the campaign reporting and the attribution behind it";
  if (/support|ticket|service desk|helpdesk/.test(text)) return "the triage and the reporting on it";
  if (/secur|complian|audit|risk/.test(text)) return "the evidence gathering and the reporting on it";
  if (/supply|logistics|inventory|procure/.test(text)) return "the stock and supplier reporting behind it";
  if (/report/.test(text)) return "the reporting and the data work behind it";
  return "the reporting and data work";
}

/** A stable 0..n-1 choice, so the same contact always gets the same wording. */
function variantFor(seed: string, count: number): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return count > 0 ? hash % count : 0;
}

/** ", open for the last 25 days" when the signal carries a number of days, otherwise nothing. */
function daysOpenPhrase(whyNow?: string | null): string {
  const match = decodeEntities(whyNow ?? "").match(/(\d{1,3})\s*days?\b/);
  if (!match) return "";
  const days = Number(match[1]);
  return days >= 14 && days <= 365 ? `, open for the last ${days} days` : "";
}

/** Possessive that reads right for a company already ending in s: "Acme Holdings'", not "Holdings's". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

const firstNameOf = (name: string) => decodeEntities(name).trim().split(/\s+/)[0] || "there";

/** Cut a subject to fit without ever ending mid-word. */
function fitSubject(subject: string, limit = 110): string {
  const clean = subject.replace(/\s{2,}/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > 20 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}

export function composeContactDraft(input: ContactDraftInput): { subject: string; body: string } {
  const company = decodeEntities(input.company).trim() || "your team";
  const first = firstNameOf(input.personName);
  const roles = input.roles ?? [];
  const parts = roleContext(roles);
  const forDays = daysOpenPhrase(input.whyNow);
  // Whole sentences, built where the role count is known, rather than a phrase dropped into a slot. The
  // zero-role phrase is prepositional ("in data and reporting"), and splicing it into "I noticed … open at
  // X" produced "I noticed in data and reporting open at Acme" on the large majority of real drafts —
  // because the roles array is empty in production far more often than the tests assumed.
  const context: Context = {
    company,
    ...parts,
    isPlural: parts.count > 1,
    need: needPhrase(roles, input.operatingNeed),
    sawLine: `I saw ${company} is hiring ${parts.hiring}${forDays}.`,
    noticedLine: parts.count
      // "open at X" already carries the word, so the days clause attaches to the role instead.
      ? `I noticed ${parts.hiring} at ${company}${forDays || " open"}.`
      : `I noticed ${company} is hiring ${parts.hiring}${forDays}.`,
  };

  const angle = ANGLES.find((entry) => entry.test.test(decodeEntities(input.personTitle)))?.angle ?? FALLBACK;
  // Seeded on the company as well as the person: seeding on the person alone sent one subject line to 103
  // different companies.
  const variant = angle.variants[variantFor(`${input.personName}|${company}|${angle.key}`, angle.variants.length)];

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
    variant.ask(context),
    "",
    "Thank you,",
  ].join("\n");

  // A subject built from a role phrase can start lowercase ("those three roles vs a system").
  const subject = fitSubject(variant.subject(context)).replace(/^[a-z]/, (char) => char.toUpperCase());
  return { subject, body };
}

/**
 * The role titles a stored signal actually carries.
 *
 * `signals.raw` is the zod-parsed ScoutSignal, and that schema has no `roles` or `open_roles` field — zod
 * strips them — so reading those keys returned an empty array for every draft ever written. The titles live
 * under `job`, which is what the scout agent fills. Two rewrites of the composer fixed the grammar this
 * caused and left the cause in place.
 */
export function rolesFromSignal(raw: Record<string, unknown> | null | undefined): string[] {
  const job = (raw ?? {}).job as { title?: unknown; responsibilities?: unknown } | undefined;
  const out: string[] = [];
  if (typeof job?.title === "string" && job.title.trim()) out.push(job.title.trim());
  if (Array.isArray(job?.responsibilities)) {
    for (const line of job.responsibilities) if (typeof line === "string" && line.trim()) out.push(line.trim());
  }
  // A cluster signal lists its roles in the summary; the scout writes them as "Title, Title, Title".
  return out.slice(0, 6);
}
