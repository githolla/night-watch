/** Normalize a line for comparison: lowercase, drop apostrophes and punctuation, collapse whitespace. */
const normalizeForCompare = (value: string) =>
  value.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * True when two lines say the same thing with only cosmetic differences — a capital letter, a contraction
 * ("I am" vs "I'm"), punctuation. Token overlap (Jaccard), so "Nice to meet you. I am founder and CEO of
 * Nine-67." and "nice to meet you. I'm founder and CEO of Nine-67." count as the same opener.
 */
export function similarText(left: string, right: string, threshold = 0.75): boolean {
  const a = new Set(normalizeForCompare(left).split(" ").filter(Boolean));
  const b = new Set(normalizeForCompare(right).split(" ").filter(Boolean));
  if (!a.size || !b.size) return false;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  const union = a.size + b.size - common;
  return union > 0 && common / union >= threshold;
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
