/**
 * Make a pasted/uploaded HTML signature safe to render and to send. Applied on WRITE (server-side) so the
 * stored value is already safe, and again before rendering, so preview and outbound share one definition.
 *
 * A previous hand-rolled version matched ` on<event>=` with a leading SPACE and was trivially bypassed by
 * `<img src=x/onerror=...>`, `<svg/onload=...>` and `javascript:` hrefs — which, rendered in an admin's
 * browser, let any member drive admin-only endpoints from that session. Deny dangerous elements and ALL
 * event handlers regardless of the separator, and allow only safe URL schemes.
 */
export function sanitizeSignatureHtml(html: string): string {
  return html
    // Elements that execute or fetch, with or without a closing tag.
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|form|link|meta|base|svg|math)\b[^>]*>/gi, "")
    // Any event handler attribute, however it's separated from the tag/previous attribute.
    .replace(/[\s/]on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Only http/https/mailto/tel and inline images may appear in a URL attribute.
    .replace(/\b(href|src|srcset|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, attr: string, dq?: string, sq?: string, bare?: string) => {
      const value = (dq ?? sq ?? bare ?? "").trim();
      const safe = /^(?:https?:|mailto:|tel:|cid:|data:image\/(?:png|jpe?g|gif|webp);base64,)/i.test(value) || /^[^a-z]*[./#]/i.test(value);
      return safe ? match : `${attr}="#"`;
    });
}

// Expanded before comparison so "I'm" and "I am" are the SAME text rather than merely similar. Without this
// the true-duplicate signal (0.96) sat uncomfortably close to genuinely different copy (0.94), leaving no
// safe threshold; expanded, a cosmetic reword scores 1.0 and a different claim stays well below.
const CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bi'?m\b/g, "i am"], [/\b(\w+)'?re\b/g, "$1 are"], [/\b(\w+)'?ve\b/g, "$1 have"], [/\b(\w+)'?ll\b/g, "$1 will"],
  [/\bcan'?t\b/g, "cannot"], [/\bwon'?t\b/g, "will not"], [/\b(\w+)n'?t\b/g, "$1 not"],
  [/\bit'?s\b/g, "it is"], [/\bthat'?s\b/g, "that is"], [/\bhere'?s\b/g, "here is"], [/\bthere'?s\b/g, "there is"],
  [/\bwhat'?s\b/g, "what is"], [/\blet'?s\b/g, "let us"],
];

/** Normalize a line for comparison: lowercase, expand contractions, drop punctuation, collapse whitespace. */
const normalizeForCompare = (value: string) => {
  let out = value.toLowerCase().replace(/[’]/g, "'");
  for (const [pattern, replacement] of CONTRACTIONS) out = out.replace(pattern, replacement);
  return out.replace(/'/g, "").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
};

/**
 * True when two lines say the same thing with only cosmetic differences — a capital letter, a contraction
 * ("I am" vs "I'm"), punctuation. Token overlap (Jaccard), so "Nice to meet you. I am founder and CEO of
 * Nine-67." and "nice to meet you. I'm founder and CEO of Nine-67." count as the same opener.
 */
/** Levenshtein distance, capped for safety on long inputs. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * True when two lines are the SAME sentence with only cosmetic differences — a capital letter, a
 * contraction ("I am" vs "I'm"), punctuation.
 *
 * Deliberately character-level, not bag-of-words. Word-overlap scoring could not tell a reworded duplicate
 * from two genuinely different sentences that share most of their words, and it was silently deleting real
 * copy: "At Mercy we cut onboarding from six weeks to two" and "At Baylor we cut onboarding from five weeks
 * to two" are different proof points, but overlap rates them ~0.85 — higher than the true duplicate pair
 * below (~0.77). Edit distance separates them cleanly (~0.96 vs ~0.87), so the bar sits at 0.97: only a cosmetic edit collapses, never a different claim.
 */
export function similarText(left: string, right: string, threshold = 0.97): boolean {
  const a = normalizeForCompare(left);
  const b = normalizeForCompare(right);
  if (!a || !b) return false;
  // Very different lengths are never the same sentence reworded.
  if (Math.min(a.length, b.length) / Math.max(a.length, b.length) < 0.75) return false;
  const ratio = 1 - editDistance(a, b) / Math.max(a.length, b.length);
  return ratio >= threshold;
}

/**
 * Drop any paragraph that repeats an earlier one in near-identical wording. A blanket "apply to all"
 * opener re-applied with a tweak (case, a contraction) otherwise stacks up and ships to the prospect two
 * or three times over. Only paragraphs of 5+ words qualify, so short lines and sign-offs are never touched.
 */
export function dedupeParagraphs(text: string): string {
  const kept: string[] = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const trimmed = paragraph.trim();
    const longEnough = normalizeForCompare(trimmed).split(" ").filter(Boolean).length >= 5;
    if (longEnough && kept.some((earlier) => similarText(earlier, trimmed))) continue;
    kept.push(trimmed);
  }
  return kept.join("\n\n");
}

// ATS/Salesforce requisition ids (e.g. "A1wuq000001tvyf2ae") get scraped onto job titles. They're noise —
// strip them from any copy we show. Matches 12+ char tokens that mix letters and digits.
const REQ_ID = /\b(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]{12,}\b/gi;

/** Clean a single scraped job title: drop the requisition id (location tails are left alone — stripping them
 *  risks eating real title words like "Data" or "Field"). */
export function cleanRoleTitle(raw: string): string {
  return (raw ?? "").replace(REQ_ID, " ").replace(/\s{2,}/g, " ").replace(/[\s,;·–-]+$/, "").trim();
}

/** Clean a sentence/paragraph of copy that may contain embedded requisition ids. */
export function sanitizeCopy(raw: string): string {
  if (!raw) return raw;
  return raw.replace(REQ_ID, "").replace(/\(\s*[,;]?\s*\)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([),.;])/g, "$1").trim();
}

// The exact block the desk's "Propose times" button inserts. Kept here so it can be taken back out again
// without disturbing the draft around it: the button writes straight into the saved email, and with no way
// to undo it a single stray click on the toolbar permanently rewrote the operator's draft.
// The closing sentence is optional — the operator may have edited it away before changing their mind.
const PROPOSED_TIMES = String.raw`\n*[ \t]*Would any of these work for a quick call\?[ \t]*\n(?:[ \t]*[•\-*][^\n]*\n?)+(?:\n*[ \t]*Happy to send a calendar invite for whichever suits\.?)?`;

/** True when a draft already carries the proposed-times block. */
export function hasProposedTimes(body: string | null | undefined): boolean {
  return new RegExp(PROPOSED_TIMES, "i").test(body ?? "");
}

/** Remove the proposed-times block (or blocks, if it was inserted more than once), leaving the rest as-is. */
export function stripProposedTimes(body: string | null | undefined): string {
  return (body ?? "").replace(new RegExp(PROPOSED_TIMES, "gi"), "").replace(/\n{3,}/g, "\n\n").trimEnd();
}

/**
 * Decode the HTML entities that arrive in scraped names and titles. Without this a contact list shows
 * "Employers&#27; Forum of Indiana" and an email would greet someone with a literal "&amp;".
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", hellip: "…",
};
export function decodeEntities(text: string | null | undefined): string {
  return decoded(text).replace(/\s{2,}/g, " ").trim();
}

/** The entity substitution both decoders share, with no whitespace handling of its own. */
function decoded(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * The same decoding for a multi-line body.
 *
 * decodeEntities collapses EVERY run of whitespace, which is right for a name or a job title and wrong for
 * an email: it welds the greeting, the pitch and the sign-off into one paragraph. Anything reading a body
 * through it sees no paragraphs at all — a check for a repeated paragraph can never fire, and a second
 * greeting stops looking like one. Runs of spaces and tabs still collapse here; line breaks survive.
 */
export function decodeBody(text: string | null | undefined): string {
  return decoded(text).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}
function safeChar(code: number): string {
  // Scrapers emit &#27; (escape) where they mean &#39; (apostrophe); anything unprintable becomes one.
  if (!Number.isFinite(code) || code < 32 || (code >= 127 && code <= 159)) return "'";
  return String.fromCodePoint(code);
}

// Words that make a comma-trailing phrase a DEPARTMENT rather than another employer. "VP, Corporate
// Development" and "VP, Finance Transformation & Advisory Services" are real titles at the company;
// "CIO, Peterson Cheese" is somebody else's CIO who happened to appear on the same page.
const DEPARTMENT = /\b(engineering|marketing|sales|finance|financial|accounting|operations?|technology|technical|product|people|talent|hr|human resources|legal|security|data|analytics|development|strategy|corporate|business|it|information|digital|transformation|advisory|services?|delivery|customer|client|success|revenue|growth|supply chain|procurement|manufacturing|quality|compliance|risk|audit|communications?|brand|design|research|infrastructure|platform|cloud|software|solutions?|programs?|projects?|innovation|partnerships?|alliances|administration|facilities|training|education|content|creative|media|公|global|north america|emea|apac|americas|region|division|group|office|affairs|relations|experience|insights?|intelligence|architecture|systems?|network|support|enablement|excellence)\b/i;

// A trailing segment that opens with one of these is the rest of a job title, not another company.
const ROLE_TAIL = /^(head|lead|leader|director|manager|chief|chair|chairman|chairwoman|president|vice|vp|svp|evp|avp|owner|partner|principal|founder|co-founder|general manager|gm|officer|counsel|controller|treasurer|secretary|editor|architect|engineer|scientist|analyst|specialist|advisor|adviser|consultant|coordinator|administrator|supervisor|associate|assistant|deputy|acting|interim|senior|junior|staff|distinguished|executive|managing|global|regional|national|corporate|group|divisional)\b/i;

/**
 * The OTHER employer named in a job title, or null when the title is just a role at this company.
 *
 * A research pass that reads a page about one company also meets executives quoted from other companies,
 * and they were being stored as contacts there. Emailing "CIO, Peterson Cheese" a pitch about Quantiphi's
 * hiring is visibly wrong to the person receiving it.
 *
 * Deliberately cautious: it only fires on a trailing comma segment that reads like an organisation and
 * matches nothing about this company. Anything uncertain returns null, because wrongly hiding a real
 * decision-maker costs more than leaving one bad row on screen.
 */
export function foreignEmployer(title: string | null | undefined, companyName: string, domain?: string | null): string | null {
  const clean = decodeEntities(title);
  // "VP of Platform Engineering at TalentNet" names the employer just as plainly as a trailing comma does.
  const atMatch = clean.match(/\s+at\s+([A-Z][^,]*)$/);
  if (atMatch) {
    const named = atMatch[1].trim().replace(/[.;]+$/, "");
    const words = named.split(/\s+/);
    // A single lowercase-ish word after "at" is usually part of the role ("Head of Data at Scale"), so it
    // takes more than one word, an internal capital (TalentNet, PayScale) or a company suffix to count.
    const looksLikeCompany = words.length > 1 || /[a-z][A-Z]/.test(named) || /\b(inc|llc|ltd|corp|co|group|holdings|partners|labs)\b/i.test(named);
    if (looksLikeCompany && words.length <= 6 && !DEPARTMENT.test(named)) {
      const other = differentCompany(named, companyName, domain);
      if (other) return other;
    }
  }
  if (!clean.includes(",")) return null;
  const tail = clean.slice(clean.lastIndexOf(",") + 1).trim().replace(/[.;]+$/, "");
  if (!tail || tail.split(/\s+/).length < 2 || tail.split(/\s+/).length > 7) return null;
  if (DEPARTMENT.test(tail)) return null;
  // "EVP, Head of E&S Casualty" is a role, not an employer. A tail that opens with a role word describes
  // what the person does here, whatever follows it.
  if (ROLE_TAIL.test(tail)) return null;
  // Must read like a proper noun: at least two capitalised words (allowing "of", "and", "the").
  const words = tail.split(/\s+/);
  const capitalised = words.filter((word) => /^[A-Z]/.test(word));
  if (capitalised.length < 2) return null;

  return differentCompany(tail, companyName, domain);
}

/** The named organisation, unless it is this company written another way. */
function differentCompany(named: string, companyName: string, domain?: string | null): string | null {
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const namedKey = normalise(named);
  const companyKey = normalise(companyName);
  const domainKey = normalise((domain ?? "").replace(/\.[a-z.]+$/, ""));
  if (!namedKey || !companyKey) return null;
  // Same company written differently ("Quantiphi Inc", "Quantiphi") is not a foreign employer.
  if (namedKey.includes(companyKey) || companyKey.includes(namedKey)) return null;
  if (domainKey && (namedKey.includes(domainKey) || domainKey.includes(namedKey))) return null;
  return named;
}

/**
 * A leading greeting in any shape a draft actually uses, INCLUDING one that runs straight into the first
 * sentence: the writing model produces "Hi Asif, Nice to meet you." on a single line, not "Hi Asif,\n\n".
 *
 * An earlier version required the greeting to end its line, so on an inline one it matched nothing: the
 * Greeting field showed the selected contact while the message underneath still opened "Hi Asif," — the
 * wrong name, twice, on every colleague at the company.
 *
 * Bounded to one or two name-ish words so it can never swallow a real opening sentence.
 *
 * The opener list runs wider than hi/hey/hello/dear because each seat now writes its own greeting. One
 * outside the list is not recognised as a greeting at all, and the composer then shows the Greeting field
 * AND leaves the greeting sitting in the message — which is the doubled "Hi Ara, Nice to meet you" that
 * had just been fixed, reintroduced by the setting that was meant to be an improvement.
 */
export const GREETING_LINE = /^[ \t]*(?:hi there|hi|hey there|hey|hello there|hello|dear|greetings|good (?:morning|afternoon|evening)|morning|afternoon)[ \t]+([A-Za-z][\w'.-]*(?:[ \t]+[A-Za-z][\w'.-]*)?)[ \t]*(?:[,!:;–—-]+[ \t]*|\n+|$)/i;

/** The first name a draft greets, or null when it opens with no greeting at all. */
export function greetedName(body: string | null | undefined): string | null {
  const match = (body ?? "").match(GREETING_LINE);
  return match ? match[1].trim() : null;
}

/** The draft with its opening greeting removed, whatever shape it took. */
export function stripLeadingGreeting(body: string | null | undefined): string {
  return (body ?? "").replace(GREETING_LINE, "").replace(/^\s+/, "");
}

/**
 * The closing lines a draft may end on. Shared with the composer so a seat's OWN sign-off is recognised as
 * a sign-off rather than read as the last sentence of the message — which would leave it in the body and
 * then put a second one underneath it on save.
 */
export const SIGNOFF_OPENERS = /^\s*(thanks|thank you|many thanks|best|best wishes|all the best|regards|kind regards|warm regards|cheers|warmly|sincerely|yours|talk soon|speak soon|appreciate it|much appreciated|with thanks|respectfully)\b/i;

/**
 * A mailbox that belongs to a function rather than a person: recruiting@, service@, info@, careers@.
 *
 * Writing a personal first-touch to one of these is worse than useless — it reads as a bot, it lands with
 * whoever staffs the inbox, and it burns the sending domain's reputation on a mailbox that never replies.
 */
const ROLE_MAILBOX = /^(?:the[-._]?)?(?:recruit\w*|talent|hiring|jobs?|careers?|apply|applications?|hr|people(?:ops)?|team|staff|admin\w*|office|reception|frontdesk|service\w*|support|help(?:desk)?|customer\w*|success|info\w*|contact\w*|hello|hi|hey|enquir\w*|inquir\w*|general|main|mail|email|webmail|postmaster|abuse|noreply|no[-._]?reply|donotreply|do[-._]?not[-._]?reply|bounce\w*|notification\w*|alerts?|system|automated|robot|bot|sales|presales|partners?|partnership\w*|biz\w*|business|marketing|media|press|pr|comms?|communications?|social|newsletter|subscribe|unsubscribe|legal|privacy|compliance|security|abuse|billing|invoic\w*|accounts?(?:payable|receivable)?|ap|ar|finance|payroll|orders?|purchasing|procurement|vendors?|suppliers?|quotes?|rfp|bids?|events?|training|education|research|investor\w*|ir|board|ethics|whistleblow\w*|feedback|survey|webmaster|it|helpme|test|demo|trial|signup|register)$/i;

export function isRoleAddress(email: string | null | undefined): boolean {
  const local = (email ?? "").trim().toLowerCase().split("@")[0];
  if (!local) return false;
  // Strip separators so "the-team", "info.uk" and "sales_us" are judged on their first word.
  const head = local.split(/[-._+]/)[0];
  return ROLE_MAILBOX.test(local) || ROLE_MAILBOX.test(head);
}

// Page titles, policies and headlines get scraped as "people": "Modern Slavery Statement", "Privacy
// Policy", "Annual Report". They have a capitalised-words shape that a name test alone cannot tell apart.
const DOCUMENT_WORD = /\b(statement|policy|policies|report|notice|terms|conditions|disclaimer|disclosure|cookies?|privacy|charter|agreement|contract|release|announcement|press|award|awards|launch|partner|partnership|webinar|whitepaper|ebook|guide|overview|summary|newsletter|bulletin|update|blog|article|case study|testimonial|faq|sitemap|careers?|jobs?|vacancy|vacancies|opportunity|opportunities|department|division|committee|board|council|foundation|institute|association|society|alliance|network|centre|center|academy|university|college|school|hospital|clinic|church|trust|fund|capital|ventures?|holdings?|group|limited|incorporated)\b/i;

/** True when a scraped "name" is really a page title, policy or headline rather than a human. */
export function looksLikeDocumentName(name: string | null | undefined): boolean {
  return DOCUMENT_WORD.test(decodeEntities(name));
}

/**
 * Marketing copy scraped as a contact: "Discover Untapped Performance", titled "Your Industry Partner", at
 * discover.performance@servicetitan.com. It defeats every other check here — three capitalised words look
 * exactly like a name, and the address is not a functional mailbox — so it reached a draft addressed to
 * "Hi Discover,". A call to action is its own shape and needs its own test.
 */

// No human's name begins with an imperative. Deliberately excludes verbs that are also common given names
// (Mark, Will, Grant, Chase, Drew), and applies to the FIRST word only, so a surname is never caught by it.
const CTA_OPENER = /^(discover|unlock|explore|learn|get|find|boost|grow|transform|maximis?e|maximize|optimis?e|optimize|elevate|accelerate|achieve|streamline|simplify|empower|enable|deliver|protect|secure|scale|modernis?e|modernize|automate|introducing|why|how|what|your|our|the|request|download|subscribe|register|schedule|explore|upgrade|reduce|increase|improve|eliminate|stop|start|ready|meet|see|book|claim|join|save|shop|watch)\b/i;

// Words that are abstractions, not name parts. Kept to ones no person is called; "Grace", "Faith", "Hope",
// "Joy", "Justice" and "Sage" are real names and are deliberately absent.
const MARKETING_NOUN = /\b(untapped|performance|solutions?|innovation|excellence|potential|efficiency|productivity|transformation|insights?|results|success|roi|savings|expertise|capabilities|scalability|reliability|visibility|uptime|downtime|workflows?|automation|analytics|dashboards?|pipelines?|onboarding|integrations?|compliance|optimisation|optimization|strategy|roadmap|platform|ecosystem|synergy|synergies|value|advantage|benefits?|features?|pricing|quote|demo|trial|offer|promo|discount)\b/i;

// A job title, not a slogan. No real title begins "Your" or "Our", and a strapline is not a role.
const MARKETING_TITLE = /^(your|our)\b|\b(industry partner|solutions provider|leading provider|trusted partner|your partner|#\s?1\b)/i;

/** True when a scraped "person" is really a call to action, a value proposition or a strapline. */
export function looksLikeMarketingPhrase(name: string | null | undefined, title?: string | null): boolean {
  const clean = decodeEntities(name).trim();
  if (clean && (CTA_OPENER.test(clean) || MARKETING_NOUN.test(clean))) return true;
  const role = decodeEntities(title ?? "").trim();
  return Boolean(role) && MARKETING_TITLE.test(role);
}

// Words that turn a company name into one of its products. A contact called "ModMed Pay" at ModMed is a
// payments product, not a colleague.
const PRODUCT_WORD = /^(pay|payments?|care|cloud|connect|connects?|app|apps|health|plus|pro|one|ai|labs?|suite|hub|portal|direct|now|go|mobile|insights?|analytics|platform|studio|works?|flow|engage|assist|central|link|sync|edge|next|prime|max|lite|online|digital|express|team|support|sales|billing|academy|university|community|marketplace|store|shop|blog|news|events?|partners?|careers?)$/i;

/**
 * True when a "contact" is one of the company's own products or sub-brands rather than a person.
 *
 * Narrow on purpose: it fires only when the name STARTS with the company's distinctive word and everything
 * after it is a product word. Founders very often share a surname with the company — Husch at Husch
 * Blackwell, Roush at Roush Enterprises — and those must never be thrown away.
 */
export function looksLikeCompanyBrand(name: string | null | undefined, company: string | null | undefined): boolean {
  const person = decodeEntities(name ?? "").trim();
  const firm = decodeEntities(company ?? "").trim();
  if (!person || !firm) return false;
  const identifier = firm.split(/\s+/)[0];
  if (identifier.length < 3) return false;
  const words = person.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  if (words[0].toLowerCase() !== identifier.toLowerCase()) return false;
  return words.slice(1).every((word) => PRODUCT_WORD.test(word.replace(/[^\p{L}\p{N}]/gu, "")));
}

/** Everything that disqualifies a scraped contact from being written to, in one place. */
export function isRealContact(person: { full_name?: string | null; email?: string | null; title?: string | null }): boolean {
  const name = decodeEntities(person.full_name ?? "").trim();
  if (/^(?:(?:domestic|international|regional|inside|outside|technical)\s+sales|human\s+resources|(?:advanced\s+)?manufacturing\s+engineering|mbaf\s+mold[- ]direct)$/i.test(name)) return false;
  if (looksLikeDocumentName(person.full_name)) return false;
  // The title matters as much as the name: "Your Industry Partner" is a strapline wherever it is filed.
  if (looksLikeMarketingPhrase(person.full_name, person.title)) return false;
  if (isRoleAddress(person.email)) return false;
  return true;
}
