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
  return (text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s{2,}/g, " ")
    .trim();
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
 */
export const GREETING_LINE = /^[ \t]*(?:hi|hey|hello|dear)[ \t]+([A-Za-z][\w'.-]*(?:[ \t]+[A-Za-z][\w'.-]*)?)[ \t]*(?:[,!:;–—-]+[ \t]*|\n+|$)/i;

/** The first name a draft greets, or null when it opens with no greeting at all. */
export function greetedName(body: string | null | undefined): string | null {
  const match = (body ?? "").match(GREETING_LINE);
  return match ? match[1].trim() : null;
}

/** The draft with its opening greeting removed, whatever shape it took. */
export function stripLeadingGreeting(body: string | null | undefined): string {
  return (body ?? "").replace(GREETING_LINE, "").replace(/^\s+/, "");
}
