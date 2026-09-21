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
