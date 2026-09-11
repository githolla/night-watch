import { z } from "zod";
import { runSearchAgent, runWritingAgent, scoutOutput, type ScoutSignal } from "./agents.ts";
import type { UsageRecorder } from "./anthropic-cost.ts";

/**
 * Deep analysis of one company by several agents working at once, each
 * with its own searches, and a synthesizer that turns what they found into
 * the manager's brief. Everything cites a URL; the synthesizer may only use
 * what the agents brought back.
 */
const url = z.string().nullable().default(null);
const happeningOutput = z.object({
  overview: z.string().default(""),
  happening: z.array(z.object({ text: z.string().min(10), date: z.string().nullable().default(null), source_url: url })).default([]),
  pain_points: z.array(z.object({ text: z.string().min(10), source_url: url })).default([]),
  tech: z.array(z.string()).default([]),
});
const hiringOutput = z.object({
  read: z.string().default(""),
  build_instead: z.array(z.string()).default([]),
  budget_estimate: z.string().nullable().default(null),
  roles: z.array(z.object({ title: z.string().min(2), url: url, posted_at: z.string().nullable().default(null), why: z.string().default("") })).default([]),
});
const peopleOutput = z.object({
  people: z.array(z.object({ name: z.string().min(3), title: z.string().min(2), linkedin_url: url, why: z.string().default(""), source_url: url, tenure: z.string().nullable().default(null) })).default([]),
  email_examples: z.array(z.string()).default([]),
  org_notes: z.string().default(""),
});
const contactOutput = z.object({
  contacts: z.array(z.object({
    name: z.string().min(3), title: z.string().default(""), email: z.string().nullable().default(null), phone: z.string().nullable().default(null),
    linkedin_url: url, source_url: url, notes: z.string().default(""),
  })).default([]),
  company: z.object({ phone: z.string().nullable().default(null), address: z.string().nullable().default(null), general_email: z.string().nullable().default(null) }).default({ phone: null, address: null, general_email: null }),
  email_examples: z.array(z.string()).default([]),
});
const voicesOutput = z.object({
  voices: z.array(z.object({ author: z.string().min(3), title: z.string().default(""), quote: z.string().min(15), url: z.string(), date: z.string().nullable().default(null), platform: z.string().default(""), topic: z.string().default("") })).default([]),
});
const briefOutput = z.object({
  brief: z.object({
    why_now: z.string().default(""),
    angle: z.string().default(""),
    who_first: z.string().default(""),
    who_first_title: z.string().default(""),
    who_first_why: z.string().default(""),
    opener: z.string().default(""),
    objections: z.array(z.string()).default([]),
    next_step: z.string().default(""),
    fit: z.number().min(0).max(100).default(0),
    fit_reason: z.string().default(""),
  }),
  signals: z.array(z.unknown()).default([]),
});

export type CompanyAnalysis = {
  version: 1;
  analyzedAt: string;
  model: string;
  costUsd: number;
  overview: string;
  happening: Array<{ text: string; date: string | null; source_url: string | null }>;
  painPoints: Array<{ text: string; source_url: string | null }>;
  tech: string[];
  hiring: { read: string; buildInstead: string[]; budgetEstimate: string | null; roles: Array<{ title: string; url: string | null; posted_at: string | null; why: string }> };
  people: Array<{ name: string; title: string; linkedin_url: string | null; why: string; source_url: string | null; tenure: string | null }>;
  orgNotes: string;
  contacts: Array<{ name: string; title: string; email: string | null; phone: string | null; linkedin_url: string | null; source_url: string | null; notes: string }>;
  company: { phone: string | null; address: string | null; general_email: string | null };
  voices: Array<{ author: string; title: string; quote: string; url: string; date: string | null; platform: string; topic: string }>;
  brief: { whyNow: string; angle: string; whoFirst: string; whoFirstTitle: string; whoFirstWhy: string; opener: string; objections: string[]; nextStep: string; fit: number; fitReason: string };
  emailExamples: string[];
  signals: ScoutSignal[];
  problems: string[];
};

export type AnalysisInput = {
  name: string;
  domain: string;
  industry: string;
  subSegment: string;
  hq: string;
  ownership: string;
  revenueBand: string;
  employees: number | null;
  ceo: string;
  buyerTitles: string[];
  aiSignalOnFile: string;
  fileNotes: string;
  rolesOnFile: Array<{ title: string; family: string; url: string }>;
  peopleOnFile: Array<{ name: string; title: string }>;
  postsOnFile: Array<{ author: string; excerpt: string; url: string }>;
};

const POSITIONING = "Nine-67 builds and runs AI and automation systems for operating teams at $50M-1B companies, so the company gets the work done without hiring a person to do it by hand: data and reporting pipelines, process automation, systems integration, CRM and back-office automation, AI assistants for internal operations. A good prospect has approved budget or a stated need for that kind of work right now.";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function facts(input: AnalysisInput) {
  return `${input.name} (${input.domain}): ${input.industry}${input.subSegment ? `, ${input.subSegment}` : ""}; ${input.hq}; ${input.ownership}; revenue band $${input.revenueBand}${input.employees ? `; ${input.employees} employees` : ""}${input.ceo ? `; CEO ${input.ceo}` : ""}.${input.aiSignalOnFile ? ` AI note on file: ${input.aiSignalOnFile}.` : ""}${input.fileNotes ? ` File notes: ${input.fileNotes}.` : ""}`;
}

/** Run the four search agents at once, then the synthesizer. Failures of one agent do not stop the others. */
export async function analyzeCompany(input: AnalysisInput, options: { model: string; searches: number }, recordUsage?: UsageRecorder): Promise<CompanyAnalysis> {
  const problems: string[] = [];
  const settle = async <T,>(label: string, work: Promise<T>, fallback: T): Promise<T> => {
    try { return await work; } catch (error) { problems.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); return fallback; }
  };
  const agent = { model: options.model, maxSearches: options.searches };
  const rolesText = input.rolesOnFile.length ? input.rolesOnFile.map((role) => `- ${role.title} (${role.family}) ${role.url}`).join("\n") : "- none on file yet";
  const peopleText = input.peopleOnFile.length ? input.peopleOnFile.map((person) => `- ${person.name}, ${person.title}`).join("\n") : "- none on file yet";

  const [happening, hiring, peopleAndContacts, voices] = await Promise.all([
    settle("company", runSearchAgent(
      `${facts(input)}\n\nToday is ${today()}. Find what is happening at ${input.name} in the last 6 months: acquisitions, funding, new leaders, new offices or products, layoffs or restructuring, technology and AI initiatives, system rollouts (ERP, CRM, data platforms), and any public statement about operational problems, growth strain, manual work, or efficiency. Search news, press releases, the company site, earnings or investor material, trade press, and podcasts. Give each item a date when shown and the URL you saw it at. Then, in two sentences, say what the company does and how it makes money. List named technologies you saw them use. Return JSON only: {"overview":"","happening":[{"text":"","date":null,"source_url":null}],"pain_points":[{"text":"","source_url":null}],"tech":[]}.`,
      agent, recordUsage).then((json) => happeningOutput.parse(json)), happeningOutput.parse({})),
    settle("hiring", runSearchAgent(
      `${facts(input)}\n\n${POSITIONING}\n\nOpen roles already on file at ${input.name}:\n${rolesText}\n\nSearch LinkedIn Jobs, Indeed, Glassdoor, the company careers page and ZipRecruiter for ${input.name}'s current openings in operations, data, analytics, systems, IT, automation, AI, RevOps, CRM, finance operations and process improvement. Read the postings you find. Then explain, as a sales strategist, what problem the company is trying to solve by hiring, which of these roles are work Nine-67 would build a system for instead of the company hiring a person (and why), and a rough annual budget the hires represent. Return JSON only: {"read":"","build_instead":[""],"budget_estimate":null,"roles":[{"title":"","url":null,"posted_at":null,"why":""}]}. Only list roles you actually saw.`,
      agent, recordUsage).then((json) => hiringOutput.parse(json)), hiringOutput.parse({})),
    (async () => {
      const found = await settle("people", runSearchAgent(
      `${facts(input)}\n\nPeople already on file at ${input.name}:\n${peopleText}\n\nOpen roles on file (the hiring managers behind these are the buyers):\n${rolesText}\n\nBuild the buying map for ${input.name}. Find the people who decide on operations, technology, data, finance and revenue systems: ${input.buyerTitles.join(", ") || "COO, CIO, CTO, CFO, CRO"}, VP or Director of Operations, IT, Data, Analytics, Business Systems, RevOps, Transformation, and the managers whose teams the open roles sit in. Search LinkedIn profile results (site:linkedin.com/in "${input.name}"), the company leadership page, press releases and conference bios. For each person give name, exact title, LinkedIn URL when seen, how long they have been there if shown, the page you saw them on, and one line on why they matter for this sale. Also record every work email address at @${input.domain} you see on public pages so the address format can be learned; never invent one. Up to 20 people. Return JSON only: {"people":[{"name":"","title":"","linkedin_url":null,"why":"","source_url":null,"tenure":null}],"email_examples":[],"org_notes":""}.`,
      agent, recordUsage).then((json) => peopleOutput.parse(json)), peopleOutput.parse({}));
      const names = [...new Map([...found.people.map((person) => [person.name.toLowerCase(), { name: person.name, title: person.title }] as const), ...input.peopleOnFile.map((person) => [person.name.toLowerCase(), person] as const)]).values()].slice(0, 25);
      const contacts = names.length ? await settle("contacts", runSearchAgent(
        `${facts(input)}\n\nThese people work at ${input.name}:\n${names.map((person) => `- ${person.name}, ${person.title}`).join("\n")}\n\nYou are the contact-details agent. For each person, find direct contact details that are published publicly: a work email address (author bios, press releases, conference speaker pages, PDF filings, event listings, company directory pages, professional-association listings), a direct or mobile phone number when it is published, and their LinkedIn URL. Search "${input.name}" with each name and with @${input.domain}. Also find the company's main phone number, headquarters address, and any general mailbox such as info@ or press@. Record every @${input.domain} address you see so the address format can be learned. Never guess or construct an address or number: only what you actually saw, with the page you saw it on. Return JSON only: {"contacts":[{"name":"","title":"","email":null,"phone":null,"linkedin_url":null,"source_url":null,"notes":""}],"company":{"phone":null,"address":null,"general_email":null},"email_examples":[]}.`,
        agent, recordUsage).then((json) => contactOutput.parse(json)), contactOutput.parse({})) : contactOutput.parse({});
      return { found, contacts };
    })(),
    settle("voices", runSearchAgent(
      `${facts(input)}\n\nPeople known to work there (search their names with site:linkedin.com/posts as well):\n${peopleText}\n\nFind what people who work at ${input.name} have said publicly in the last 12 months about AI, automation, data, systems, operations, efficiency, hiring difficulty, or problems in their own work: LinkedIn posts (site:linkedin.com/posts "${input.name}"), LinkedIn articles (site:linkedin.com/pulse "${input.name}"), podcast and webinar appearances, conference talks, interviews where they are quoted, and X posts. Only count a named person who works at ${input.name}; a company press release is not a voice. For each, give the author, their title, a verbatim quote of up to 400 characters, the URL, the date when shown, the platform, and a three-to-six-word topic. Up to 12. Return JSON only: {"voices":[{"author":"","title":"","quote":"","url":"","date":null,"platform":"","topic":""}]}.`,
      agent, recordUsage).then((json) => voicesOutput.parse(json)), voicesOutput.parse({})),
  ]);

  const people = peopleAndContacts.found;
  const contacts = peopleAndContacts.contacts;
  const evidence = JSON.stringify({
    company: happening, hiring, people: people.people.slice(0, 20), org_notes: people.org_notes, contacts: contacts.contacts.slice(0, 25), company_contact: contacts.company, voices: voices.voices,
    posts_on_file: input.postsOnFile.slice(0, 10), roles_on_file: input.rolesOnFile.slice(0, 20),
  }).slice(0, 60_000);

  const synthesized = await settle("brief", runWritingAgent(
    `${POSITIONING}\n\nToday is ${today()}. You are preparing a sales manager at Nine-67 to decide whether and how to approach ${input.name}. Facts on file: ${facts(input)}\n\nEverything the research agents found, as JSON (use only this; do not add facts you do not see here):\n${evidence}\n\nWrite, in plain direct English a manager can read in a minute:\n- why_now: why this company is worth contacting now, citing the concrete things found (roles, initiatives, quotes). Three to five sentences. If there is no real reason, say so plainly.\n- angle: the one Nine-67 offer that fits, in two sentences: what we would build or run instead of what they are doing or hiring for.\n- who_first / who_first_title / who_first_why: the single best person to write to and why them.\n- opener: a two-sentence personalised opening line for that person, referring to something specific they said or are doing. No flattery, no jargon.\n- objections: the two or three most likely pushbacks and the answer to each, as short strings.\n- next_step: the one thing the manager should do now.\n- fit: 0-100, how strong a prospect this is today, and fit_reason in one sentence.\n\nThen list signals: the concrete qualifying evidence, each as an object in this exact shape, only when the evidence is real and has a URL from the input: {"type":"job_post"|"job_cluster"|"exec_post"|"new_leader"|"funding","summary":"","source_url":"https://...","observed_at":"YYYY-MM-DD","operating_need":"the specific work Nine-67 could build or run instead","evidence_kind":"hiring"|"asking_for_help"|"ai_post"|"new_mandate"|"growth_event","people":[{"name":"","title":"","role_in_signal":""}],"confidence":0.0-1.0}. For exec_post include "post":{"text":"verbatim quote","author_name":"","author_title":"","published_at":null,"is_excerpt":true}. For job_post include "job":{"title":"","department":"","days_open":0,"reposted":false,"salary_max":0,"tools_named":[],"responsibilities":[]}. Opinion pieces and press releases are not signals. Up to 4 signals. Return JSON only: {"brief":{...},"signals":[...]}.`,
    { model: options.model, maxTokens: 6_000 }, recordUsage).then((json) => briefOutput.parse(json)), briefOutput.parse({ brief: {} }));

  const signals: ScoutSignal[] = [];
  for (const raw of synthesized.signals) {
    const parsed = scoutOutput.shape.signals.element.safeParse(raw);
    if (parsed.success) signals.push(parsed.data);
    else problems.push(`signal dropped: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }

  return {
    version: 1, analyzedAt: new Date().toISOString(), model: options.model, costUsd: 0,
    overview: happening.overview, happening: happening.happening, painPoints: happening.pain_points, tech: happening.tech,
    hiring: { read: hiring.read, buildInstead: hiring.build_instead, budgetEstimate: hiring.budget_estimate, roles: hiring.roles },
    people: people.people, orgNotes: people.org_notes, contacts: contacts.contacts, company: contacts.company, voices: voices.voices,
    brief: {
      whyNow: synthesized.brief.why_now, angle: synthesized.brief.angle, whoFirst: synthesized.brief.who_first, whoFirstTitle: synthesized.brief.who_first_title, whoFirstWhy: synthesized.brief.who_first_why,
      opener: synthesized.brief.opener, objections: synthesized.brief.objections, nextStep: synthesized.brief.next_step, fit: synthesized.brief.fit, fitReason: synthesized.brief.fit_reason,
    },
    emailExamples: [...people.email_examples, ...contacts.email_examples, ...contacts.contacts.map((contact) => contact.email ?? "")].filter((email) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)),
    signals, problems,
  };
}

/** Read a stored analysis back, tolerating older or partial shapes. */
export function parseStoredAnalysis(value: unknown): CompanyAnalysis | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CompanyAnalysis>;
  if (!record.brief || typeof record.brief !== "object") return null;
  return {
    version: 1, analyzedAt: record.analyzedAt ?? "", model: record.model ?? "", costUsd: Number(record.costUsd ?? 0),
    overview: record.overview ?? "", happening: record.happening ?? [], painPoints: record.painPoints ?? [], tech: record.tech ?? [],
    hiring: record.hiring ?? { read: "", buildInstead: [], budgetEstimate: null, roles: [] },
    people: record.people ?? [], orgNotes: record.orgNotes ?? "", contacts: record.contacts ?? [], company: record.company ?? { phone: null, address: null, general_email: null }, voices: record.voices ?? [],
    brief: { ...{ whyNow: "", angle: "", whoFirst: "", whoFirstTitle: "", whoFirstWhy: "", opener: "", objections: [], nextStep: "", fit: 0, fitReason: "" }, ...record.brief },
    emailExamples: record.emailExamples ?? [], signals: record.signals ?? [], problems: record.problems ?? [],
  };
}
