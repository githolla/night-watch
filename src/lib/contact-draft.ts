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
  /**
   * This contact's position in the company's list, which is what keeps two colleagues on the same angle off
   * the same wording. Pass a number and it rotates the copy pools, so positions 0..3 are guaranteed to draw
   * four different pitches; leave it out and the choice falls back to a hash of the name, which collides
   * one time in four. The bulk drafter passes the position; the one-person route works it out from the
   * colleagues already drafted.
   */
  variantSalt?: string | number | null;
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

/**
 * Each angle holds independent pools. The subject, the pitch and the ask are picked with separate seeds, so
 * four of each gives sixteen combinations rather than four — paired variants meant three colleagues at one
 * company could receive a byte-identical pitch, which is exactly the mail merge this exists to avoid.
 */
type Angle = {
  key: string;
  subjects: Array<(c: Context) => string>;
  /** true picks the "I saw" opening, false the "I noticed" one. */
  offers: Array<(c: Context) => string>;
  asks: string[];
};

/**
 * Titles are matched as PREFIXES, not whole words. The previous table wrapped stems in \b…\b, so
 * "chief technolog" matched nothing in "Chief Technology Officer" (125 mentions on the list fell through to
 * the generic angle), and "treasur" missed "Treasurer", "recruit" missed "Recruiter".
 */
const ANGLES: Array<{ test: RegExp; angle: Angle }> = [
  {
    // Money. Checked before technology so "VP, Finance Transformation" is finance, not transformation.
    test: /\b(cfo|chief financial\w*|controller\w*|treasur\w*|finance\w*|financial\w*|accounting|fp&a|chief accounting\w*)\b/i,
    angle: { key: "finance",
      subjects: [
        (c) => `${c.company}: the cost of ${c.bareNoun}`,
        (c) => `${c.bareNoun} at ${c.company}, or a system`,
        (c) => `What ${c.bareNoun} costs ${c.company} fully loaded`,
        (c) => `A cheaper way through ${c.bareNoun}`,
      ],
      offers: [
        (c) => `Before that becomes salary it is worth pricing the alternative. We build and run ${c.need}, so the output arrives without the headcount and the cost is a build rather than a permanent line on payroll.`,
        (c) => `Fully loaded, a role like that runs well past its salary once recruiting, ramp and the months of waiting are counted. We build ${c.need} once instead, and run it.`,
        (c) => `The part people tend to miss is the months before anyone starts, when the work is simply not getting done. We build ${c.need} now, at a fixed cost, and it keeps running whoever you hire later.`,
        (c) => `A build is capital you can stop spending; a salary is not. We put ${c.need} on a system you own, so the cost lands once rather than every month.`,
      ],
      asks: [
        "Would a rough cost comparison be useful?",
        "Happy to put rough numbers side by side if that helps.",
        "Is the budget for that already committed, or still open?",
        "Would it help to see what a build like that runs to?",
      ] },
  },
  {
    // Whoever owns what gets built.
    test: /\b(cto|chief technolog\w*|chief information officer|cio|chief digital\w*|chief data\w*|chief analytics\w*|chief ai\w*|chief innovation\w*|chief knowledge\w*|chief product\w*|engineering|engineer|architect\w*|platform\w*|infrastructure|devops|technolog\w*|technical|digital|ecommerce|e-commerce|data|analytics|bi\b|business intelligence|it\b|information technology|software|cloud|product)\b/i,
    angle: { key: "engineering",
      subjects: [
        (c) => `${c.company}: building ${c.bareNoun} instead of filling ${c.pronoun}`,
        (c) => `The build behind ${possessive(c.company)} open ${c.isPlural ? "roles" : "role"}`,
        (c) => `${c.company}: who owns that work once it is built`,
        (c) => `A system for ${c.bareNoun} at ${c.company}`,
      ],
      offers: [
        (c) => `We build ${c.need} as real infrastructure, owned end to end: scheduling, checks that fail loudly, and the reporting on top. That is the work the postings describe, running as a system rather than maintained by hand.`,
        (c) => `We build ${c.need} and hand it over documented, so it is something your team owns rather than inherits. It runs whether or not the hire lands.`,
        (c) => `The useful question is usually which parts of that work should be a person and which should be a pipeline. We build the pipeline half of ${c.need} and leave the judgement to your team.`,
        (c) => `We put ${c.need} behind one scheduled job with tests around it, so a failure is an alert rather than something noticed a week later in a number that looks wrong.`,
      ],
      asks: [
        "Happy to sketch how we would structure it. Worth a look?",
        "What does that work run on at the moment?",
        "Would a short technical walkthrough be useful?",
        "Is that closer to a build problem or a hiring one for you?",
      ] },
  },
  {
    test: /\b(ciso|chief information security\w*|chief security\w*|security|infosec|cyber\w*|risk|compliance|privacy|audit|chief claims\w*)\b/i,
    angle: { key: "security",
      subjects: [
        (c) => c.count
          ? `${c.company}: who touches the data once ${c.bareNoun} ${c.isPlural ? "are" : "is"} filled`
          : `${c.company}: who touches the data as the team grows`,
        (c) => `Data handling behind ${possessive(c.company)} new ${c.isPlural ? "roles" : "role"}`,
        (c) => `${c.company}: keeping that work off personal exports`,
        (c) => `One controlled path for ${c.bareNoun}`,
      ],
      offers: [
        (c) => `New hands on data usually means new copies of it. We build ${c.need} as one controlled path, so access is granted rather than assumed and there is a record of what moved.`,
        (c) => `Work stood up in a hurry tends to end up spread across spreadsheets and personal exports. We build ${c.need} once, in one place, with access controlled and movement logged.`,
        (c) => `Every new person doing this work is another set of credentials and another local copy. We build ${c.need} so the data stays in one place and people are given a view of it rather than a download.`,
        (c) => `We build ${c.need} with the access model decided up front, so an audit is a query rather than an archaeology exercise.`,
      ],
      asks: [
        "Is that worth a short conversation?",
        "Would it help to see how we handle that?",
        "Where does that data sit at the moment?",
        "Is that a live concern there, or already covered?",
      ] },
  },
  {
    test: /\b(coo|chief operating\w*|operations|operational|ops|supply chain|procurement|logistics|delivery|process|plant|manufactur\w*|merchandis\w*|managed services|service delivery|fulfilment|fulfillment)\b/i,
    angle: { key: "operations",
      subjects: [
        (c) => `${c.company}: the repeatable half of ${c.bareNoun}`,
        (c) => `Covering ${c.bareNoun} at ${c.company}`,
        (c) => `${c.company}: the part of that work that repeats`,
        (c) => `Doing ${c.bareNoun} with the team you have`,
      ],
      offers: [
        (c) => `Work like this usually splits in two: the part that repeats and the part that needs judgement. We build and run ${c.need} so a smaller team covers the rest.`,
        (c) => `We build ${c.need} so the routine part runs itself and the people you already have handle the exceptions.`,
        () => `Most of the hours in work like this go on assembling and checking rather than deciding. We take the assembling, on a schedule, and leave the deciding with your team.`,
        (c) => `We automate ${c.need} end to end and put the exceptions in a queue, so the volume stops scaling with headcount.`,
      ],
      asks: [
        "Worth twenty minutes to work out where that line sits?",
        "Which part of that eats the most time right now?",
        "How much of that is done by hand today?",
        "Would it help to map which half is which?",
      ] },
  },
  {
    test: /\b(chro|chief people\w*|chief human\w*|people|talent|recruit\w*|hr\b|human resources|staffing|workforce)\b/i,
    angle: { key: "people",
      subjects: [
        (c) => `${c.company}: cover for ${c.bareNoun} while you search`,
        (c) => `${c.bareNoun} and time to hire at ${c.company}`,
        (c) => `${c.company}: the work while the search runs`,
        (c) => `Taking pressure off ${c.bareNoun}`,
      ],
      offers: [
        (c) => `The gap between posting and a productive start is usually where the backlog builds. We stand up ${c.need} in the meantime, and it keeps working whoever you hire.`,
        (c) => `Technical roles like these often sit open for months and the work waits the whole time. We build and run ${c.need} so the output starts now, which takes pressure off the search rather than replacing it.`,
        (c) => `A search that has to be filled fast tends to be filled badly. We cover ${c.need} with a system so the hire can be the right one rather than the available one.`,
        (c) => `We build ${c.need} so the role you eventually fill is the interesting half of the job, which is an easier role to hire for.`,
      ],
      asks: [
        "Is the wait the painful part here?",
        "Would it help to have that running while you hire?",
        "How long have those been open?",
        "Is the search the bottleneck, or the work itself?",
      ] },
  },
  {
    test: /\b(cmo|marketing|brand|demand gen\w*|growth|communications|media|advertis\w*)\b/i,
    angle: { key: "marketing",
      subjects: [
        (c) => `Getting numbers out of ${c.company} faster`,
        (c) => `${c.company}: reporting behind ${c.bareNoun}`,
        (c) => `${c.company}: numbers that arrive on their own`,
        (c) => `One source for ${possessive(c.company)} reporting`,
      ],
      offers: [
        (c) => `Waiting on a hire usually means waiting on the numbers too. We build ${c.need} so what you need to decide with shows up without anyone assembling it by hand.`,
        (c) => `Teams often feel this first as reporting that lands late and never quite reconciles. We build ${c.need} so the numbers arrive on a schedule, from one source.`,
        (c) => `The cost of slow reporting is usually decisions made on last month's picture. We build ${c.need} so the current one is always there.`,
        (c) => `We build ${c.need} so the weekly number is produced rather than compiled, and it says the same thing wherever you read it.`,
      ],
      asks: [
        "What reporting do you chase most often?",
        "Is reporting turnaround a problem worth solving there?",
        "How long does the weekly picture take to put together?",
        "Would faster numbers actually change a decision for you?",
      ] },
  },
  {
    // Anyone senior enough to weigh a hire against a build. Last, so a more specific angle wins first.
    test: /\b(ceo|chief executive\w*|founder|co-founder|president|owner|managing partner|managing director|executive director|operating partner|value creation\w*|partner|principal|chief of staff|general manager|gm\b|cpo|chief strategy\w*|chief revenue\w*|cro|chief commercial\w*|chief transformation\w*|board|vp sales|sales)\b/i,
    angle: { key: "executive",
      subjects: [
        (c) => `${c.company}: ${c.bareNoun}, or a system`,
        (c) => `Before ${c.company} fills ${c.bareNoun}`,
        (c) => `${c.company}: a reversible version of that decision`,
        (c) => `${c.bareNoun}, without growing the team`,
      ],
      offers: [
        (c) => `That is a permanent cost for work that largely repeats. We build and run ${c.need} instead, so the output arrives without growing the team, and the decision stays reversible.`,
        (c) => `Hiring is the obvious answer and not always the cheaper one. We build ${c.need} as a system you own, which costs a build rather than a payroll line and can be undone if it does not earn its place.`,
        (c) => `Headcount is the hardest decision to reverse. We build ${c.need} first, so you find out what the work actually needs before committing to a permanent seat.`,
        (c) => `We build and run ${c.need}, so the output starts in weeks rather than after a search, a notice period and a new hire's first quarter.`,
      ],
      asks: [
        "Worth twenty minutes to compare the two?",
        "Would it be useful to see what that looks like for you?",
        "Is that decision already made, or still open?",
        "Happy to walk through how we would scope it, if useful.",
      ] },
  },
];

const FALLBACK: Angle = { key: "general",
  subjects: [
    (c) => `${c.company} and ${c.bareNoun}`,
    (c) => `${c.company}: ${c.bareNoun} without the hire`,
    (c) => `A system for that work at ${c.company}`,
  ],
  offers: [
    (c) => `We build and run ${c.need}, so that work gets done as a system rather than a hire. It runs on a schedule, from one source, and your team owns it.`,
    (c) => `We build ${c.need} and run it, so the output starts without waiting on a hire, and keeps working once one lands.`,
    (c) => `We take ${c.need} and put it on a system you own, so the routine part stops needing a person and the rest gets easier to staff.`,
  ],
  asks: [
    "Is that worth a short conversation?",
    "Happy to explain how that works if it is useful.",
    "Would a quick walkthrough be useful?",
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
 * Careers-page furniture that a scraper takes as part of the title: the link text wrapping the posting
 * ("Apply for X … Apply", "View job", "Learn more"). It produced a real draft naming "Apply for Adobe
 * Multi-Solution Architect and Apply for Multi-Solution Architect Apply" — the word Apply three times in
 * one sentence, and two roles that looked identical once the tail was cut.
 */
const POSTING_CHROME_HEAD = /^\s*(?:apply (?:for|to|now for)|view|see|read more about|explore|job:|role:|position:|opening:|vacancy:)\s+/i;
const POSTING_CHROME_TAIL = /[\s,–—-]*\b(?:apply(?:\s+now)?|apply here|learn more|read more|view job|view role|view details|see details|see more|more info|details)\b[\s.>»]*$/i;

/**
 * A posting title trimmed to something that reads inside a sentence: no parenthetical, no location or
 * employment-type tail, no trailing requisition code. A subject line built from an untrimmed title was being
 * cut mid-word at 120 characters.
 */
function tidyRole(raw: string): string {
  let role = decodeEntities(raw)
    .replace(COUNT_PREFIX, "")
    // Twice: "Apply for Solution Architect Apply Now" carries chrome at both ends, and cutting the tail can
    // expose another ("… Apply Learn more").
    .replace(POSTING_CHROME_HEAD, "").replace(POSTING_CHROME_TAIL, "").replace(POSTING_CHROME_TAIL, "")
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

/**
 * "6 roles:", "six open roles including" — a cluster signal often records its WHOLE list in one string, and
 * that string was being read as a role title. A real draft went out reading "hiring six roles, including
 * 6 roles: Data Engineer and Data Engineer": the count twice, the same role twice, and a colon in the
 * middle of a sentence.
 */
const COUNT_PREFIX = /^\s*(?:\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:new\s+|open\s+)?roles?\b\s*(?:including|incl\.?|such as|like)?\s*[:,–—-]?\s*/i;

/**
 * One string that is really a list becomes the list. Only split when the count prefix proves it is one:
 * plenty of genuine titles carry a comma ("Manager, Sales Ops"), and splitting those invents roles that
 * were never posted.
 */
function expandRoleList(value: string): string[] {
  const match = value.match(COUNT_PREFIX);
  if (!match) return [value];
  const rest = value.slice(match[0].length).trim();
  if (!rest) return [];
  return rest.split(/\s*[;,]\s*(?=[A-Z0-9])/).map((part) => part.trim()).filter(Boolean);
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

/**
 * A stable 0..n-1 choice, so the same contact always gets the same wording.
 *
 * `rotate` is added AFTER the hash rather than mixed into the seed. Mixing it in still left two colleagues
 * on the same angle a one-in-four chance of drawing the same pitch — measured at 40 collisions in 480
 * drafts, which is the mail merge this exists to avoid. Rotating guarantees that consecutive positions at
 * one company land on different copy while the hash still spreads unrelated people across the pool.
 */
function variantFor(seed: string, count: number, rotate = 0): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return count > 0 ? (hash + rotate) % count : 0;
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
  // Each part is seeded separately, so four subjects, four pitches and four asks give sixty-four
  // combinations per angle rather than four. Still stable: the same person always gets the same draft.
  // The base is the company and the angle, SHARED by colleagues, and the position rotates away from it.
  // Hashing the person's name instead gave each colleague an independent draw from a pool of four, so a
  // real pair landed on identical copy a quarter of the time — measured at 40 collisions in 480 drafts.
  // Rotating a shared base makes four colleagues four different letters by construction.
  // With no position to work from, the name is the rotation: still spread, just not guaranteed.
  const rotate = typeof input.variantSalt === "number"
    ? Math.abs(Math.trunc(input.variantSalt))
    : variantFor(input.personName, 997);
  const seed = `${company}|${angle.key}|${typeof input.variantSalt === "string" ? input.variantSalt : ""}`;
  const subjectLine = angle.subjects[variantFor(`${seed}|subject`, angle.subjects.length, rotate)];
  const offerLine = angle.offers[variantFor(`${seed}|offer`, angle.offers.length, rotate)];
  const askLine = angle.asks[variantFor(`${seed}|ask`, angle.asks.length, rotate)];
  // Which of the two openings, also independently.
  const opening = variantFor(`${seed}|open`, 2, rotate) === 0 ? context.sawLine : context.noticedLine;

  const senderName = decodeEntities(input.senderName ?? "").trim();
  const senderTitle = decodeEntities(input.senderTitle ?? "").trim();
  const intro = senderName
    ? `I am ${senderName}${senderTitle ? `, ${senderTitle}` : ""} at Nine-67.`
    : "I am with Nine-67.";

  const body = [
    `Hi ${first},`,
    "",
    `${intro} ${opening}`,
    "",
    offerLine(context),
    "",
    askLine,
    "",
    "Thank you,",
  ].join("\n");

  // A subject built from a role phrase can start lowercase ("those three roles vs a system").
  const subject = fitSubject(subjectLine(context)).replace(/^[a-z]/, (char) => char.toUpperCase());
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
  if (typeof job?.title === "string" && job.title.trim()) out.push(...expandRoleList(job.title.trim()));
  if (Array.isArray(job?.responsibilities)) {
    for (const line of job.responsibilities) if (typeof line === "string" && line.trim()) out.push(...expandRoleList(line.trim()));
  }
  // A cluster signal lists its roles in the summary; the scout writes them as "Title, Title, Title".
  return out.slice(0, 6);
}
