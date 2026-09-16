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
