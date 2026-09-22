import { decodeBody, decodeEntities, greetedName, isRealContact, looksLikeCompanyBrand, stripLeadingGreeting } from "./clean.ts";

/**
 * Every way a saved draft can be wrong, checked in one place.
 *
 * Written because "I audited it" kept turning out to mean "I checked the two things I had thought of". The
 * rules below are each a fault that actually reached a real prospect's screen at some point tonight: a
 * greeting for one person on an email to another, a call to action filed as a contact and addressed as
 * "Hi Discover,", a cluster summary read as a job title, a subject still saying TEST.
 *
 * Pure and client-safe: it takes a row and returns what is wrong with it, so the same rules can run in a
 * bulk audit, in a test, or on one draft in the composer.
 */

export type AuditRow = {
  id: string;
  status: string;
  subject: string | null;
  body: string | null;
  personName: string | null;
  personTitle: string | null;
  personEmail: string | null;
  company: string | null;
};

export type Fault = {
  /** Stable key, so faults can be counted and grouped. */
  rule: string;
  /** What is wrong, in the words you would use to explain it. */
  says: string;
  /** true when this must never be sent; false when it is worth a look but not a blocker. */
  blocking: boolean;
};

/** The send route's own cap. A draft over it cannot be sent at all. */
const BODY_LIMIT = 1000;
const SUBJECT_LIMIT = 120;
/** Subjects that are obviously a placeholder rather than a line written to earn a reply. */
const PLACEHOLDER_SUBJECT = /^(test|testing|subject|draft|todo|tbd|xxx|asdf|n\/a|\.+)$/i;

const firstNameOf = (name: string | null | undefined) => decodeEntities(name ?? "").trim().split(/\s+/)[0] ?? "";

export function auditDraft(row: AuditRow): Fault[] {
  const faults: Fault[] = [];
  const say = (rule: string, says: string, blocking = true) => faults.push({ rule, says, blocking });

  const subject = decodeEntities(row.subject ?? "").trim();
  // decodeBody, not decodeEntities: the latter collapses newlines, which would flatten the email into
  // one paragraph and quietly disable every check below that depends on its shape.
  const body = decodeBody(row.body);
  const first = firstNameOf(row.personName);
  const company = decodeEntities(row.company ?? "").trim();

  // — Is there an email at all —
  if (!body) { say("no-body", "No message written yet."); return faults; }
  if (!subject) say("no-subject", "No subject line, so it cannot be sent.");
  else if (/without (?:the |a )?hire|instead of (?:a |the )?hire|routine part stops needing a person|without growing the team/i.test(`${subject} ${body}`)) say("retired-positioning", "This draft still pitches replacing hires instead of delivering working applications.");
  else if (PLACEHOLDER_SUBJECT.test(subject)) say("placeholder-subject", `The subject is still “${subject}”.`);
  else if (subject.length > SUBJECT_LIMIT) say("subject-long", `The subject is ${subject.length} characters; anything past about ${SUBJECT_LIMIT} is cut off in the inbox.`, false);

  // — Is the recipient a person —
  if (!isRealContact({ full_name: row.personName, title: row.personTitle, email: row.personEmail })) {
    say("not-a-person", `“${row.personName ?? "This contact"}” is not a person — it is a phrase or a functional mailbox.`);
  } else if (looksLikeCompanyBrand(row.personName, row.company)) {
    say("not-a-person", `“${row.personName}” is one of ${company}'s own products, not a person there.`);
  }

  // — Is it addressed to them —
  const greeted = greetedName(body);
  if (!greeted) say("no-greeting", "It does not open with a greeting.", false);
  else if (first && greeted.toLowerCase() !== first.toLowerCase()) {
    say("wrong-greeting", `It greets “${greeted}” but is addressed to ${row.personName}.`);
  }
  // The name a second time reads as a mail merge; the WRONG name means it was written for someone else.
  const afterGreeting = stripLeadingGreeting(body);
  if (first && new RegExp(`\\b${escapeRegExp(first)}\\b`).test(afterGreeting)) {
    say("name-twice", `“${first}” appears again inside the message.`, false);
  }

  // — Would it embarrass you —
  if (/[{}]|\bundefined\b|\bNaN\b|\bnull\b/.test(body) || /[{}]|\bundefined\b|\bNaN\b/.test(subject)) {
    say("placeholder", "An unfilled placeholder is still in the text.");
  }
  if (/https?:\/\//.test(body)) say("link-in-body", "There is a link in the body; the signature already carries one and two trips spam filters.");
  if (body.length > BODY_LIMIT) say("too-long", `The body is ${body.length} characters and the send route refuses anything over ${BODY_LIMIT}.`);
  if (company && !namesCompany(body, company)) say("no-company", `It never names ${company}.`, false);

  const text = `${subject}\n${body}`;
  if (/\broles?\s*:/i.test(text)) say("list-as-title", "A list of roles was read as one job title, so a colon is sitting mid-sentence.");
  if (/\b(\w[\w -]{2,}?) and \1\b/i.test(text)) say("same-role-twice", `The same thing is named twice: “${text.match(/\b(\w[\w -]{2,}?) and \1\b/i)?.[0]}”.`);
  if (/\b(\w+) \1\b/i.test(text)) say("doubled-word", `A word is repeated: “${text.match(/\b(\w+) \1\b/i)?.[0]}”.`);
  if (/\b(a) +[aeiou]/i.test(text) && !/\b(a) +(one|use|user|uni|euro|u[bcgkmnprst])/i.test(text)) say("article", "“a” is used before a vowel sound.", false);
  if (/\b(Apply|Req #|Requisition)\b/i.test(text)) say("posting-junk", "Boilerplate from the job posting is still in the text.", false);
  // "We put the financial reporting and the reconciliation under it behind one scheduled job" — one phrase
  // ending in a preposition, followed by another. It read as a typo and was in most of the drafts.
  if (/\b(under|behind|around|over|into|on|with|from) (it|them) (behind|under|around|over|into|on|with|from|first|once|end)\b/i.test(text)) {
    say("preposition-pileup", "Two prepositions run together, so the sentence does not parse.");
  }
  // "I noticed five roles, including Senior Business Analyst and Manager at Trinity Life Sciences open." —
  // a sentence that ends on an adjective with nothing left to attach it to.
  if (/\bat [A-Z][^.!?]{0,60}\bopen\.(?:\s|$)/.test(text)) {
    say("stranded-open", "A sentence ends on “open” with nothing for it to attach to.");
  }
  // Two identical paragraphs — a greeting or opener that saved twice.
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  if (new Set(paragraphs).size !== paragraphs.length) say("repeat-paragraph", "The same paragraph appears twice.");
  // "Hi Ara, Nice to meet you" — a greeting welded into the first line under a greeting field of its own.
  if (/^(hi|hey|hello|dear)\b[^\n,]*,\s*\S/i.test(afterGreeting.split("\n")[0] ?? "")) {
    say("greeting-twice", "The message starts with a second greeting on the same line.");
  }

  return faults;
}

// Words that carry no identity: what is left once they go is what a person would actually write. Without
// this, an email to Q2 Holdings that says "Q2" eight times was reported as never naming the company, and an
// audit that invents faults is no more use than one that misses them.
const COMPANY_FURNITURE = /\b(inc|inc\.|incorporated|corp|corp\.|corporation|company|co|co\.|llc|l\.l\.c\.|ltd|ltd\.|limited|plc|group|holdings?|technologies|technology|software|solutions?|systems?|services?|enterprises?|partners|ventures|labs?|global|international|worldwide|usa?|of|the|and|&)\b/gi;

/**
 * True when the draft names the company, allowing for the way people actually write it.
 *
 * An exact match alone reported "never names Q2 Holdings" on an email that says Q2 throughout, and the same
 * for "The RealReal" written as RealReal and "Seacoast Banking Corp of Florida" written as Seacoast
 * Banking. An audit that invents faults is no more use than one that misses them, so this looks for the
 * distinctive word rather than the registered name.
 */
function namesCompany(body: string, company: string): boolean {
  const text = body.toLowerCase();
  if (text.includes(company.toLowerCase())) return true;
  const core = company.replace(COMPANY_FURNITURE, " ").replace(/\s{2,}/g, " ").trim();
  // Nothing distinctive left ("The Group") — the full name was the only test there was.
  if (!core) return false;
  // The first surviving word is the identifying one: Seacoast, Q2, RealReal.
  const identifier = core.split(/\s+/)[0];
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "i").test(body);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when nothing found would stop this being sent. */
export const isSendable = (faults: Fault[]) => !faults.some((fault) => fault.blocking);
