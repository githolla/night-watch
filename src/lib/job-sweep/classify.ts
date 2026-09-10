/**
 * Job-title classification against the families where Nine-67 does the work
 * instead of the company hiring for it. Pure rules, no model, so the whole
 * universe can be classified for free and the result is reproducible.
 * Mirrors the "Target job families" list in docs/scoring.md.
 */

export type JobFamily =
  | "ai_ml"
  | "automation"
  | "data_analyst"
  | "revops"
  | "ops_analyst"
  | "support"
  | "sdr"
  | "systems_integration"
  | "crm_admin";

export const FAMILY_LABEL: Record<JobFamily, string> = {
  ai_ml: "AI / machine learning",
  automation: "Automation and process",
  data_analyst: "Data and analytics",
  revops: "Revenue operations",
  ops_analyst: "Operations analysis",
  support: "Volume customer support",
  sdr: "Sales development",
  systems_integration: "Systems and integration",
  crm_admin: "CRM administration",
};

/** Titles that never qualify, however the words fall. */
const EXCLUDE =
  /\b(nurse|rn|lpn|cna|physician|pharmac|driver|cdl|warehouse|forklift|mechanic|welder|electrician|plumber|technician|cashier|cook|chef|dishwasher|janitor|custodian|housekeep|security (guard|officer)|lifeguard|teacher|intern(ship)?|apprentice|attorney|paralegal|counsel|surgeon|dental|veterinar|pilot|barista|server|bartender|line cook|merchandiser|stocker|loader|picker|packer)\b/i;

/** Ordered: the first family whose pattern matches wins. */
const RULES: Array<[JobFamily, RegExp]> = [
  ["ai_ml", /\b(ai|a\.i\.|artificial intelligence|machine learning|\bml\b|llm|generative|nlp|deep learning|data scien|computer vision|prompt engineer|applied scientist)\b/i],
  ["revops", /\b(rev ?ops|revenue operations|sales operations|sales ops|marketing operations|marketing ops|gtm operations|go-to-market operations|deal desk|sales enablement)\b/i],
  ["crm_admin", /\b(salesforce|hubspot|dynamics 365|crm)\b.*\b(admin|administrator|manager|specialist|analyst|developer|engineer|architect)\b|\b(crm|salesforce) (admin|administrator)\b/i],
  ["systems_integration", /\b(systems? (analyst|administrator|engineer|integration|specialist)|integration (engineer|specialist|analyst|developer|architect)|erp (analyst|administrator|specialist|manager|consultant)|netsuite|workday (analyst|administrator|consultant|specialist)|sap (analyst|consultant|specialist|administrator)|api (engineer|developer|integration)|it business analyst|business systems|solutions? (engineer|architect|analyst)|middleware|ipaas|boomi|mulesoft|workato)\b/i],
  ["automation", /\b(automation|rpa|robotic process|process (improvement|engineer|excellence|optimization|analyst)|continuous improvement|workflow|business process|lean|six sigma|operational excellence|transformation (analyst|manager|lead))\b/i],
  ["sdr", /\b(sdr|bdr|sales development|business development (rep|representative|associate|specialist)|inside sales|lead generation|lead gen|appointment setter|outbound (sales|specialist)|demand generation)\b/i],
  ["support", /\b(customer (support|service|care|success|experience) (rep|representative|specialist|associate|agent|advocate|coordinator|analyst|manager)|support (specialist|agent|representative|associate|analyst|engineer|coordinator)|call center|contact center|help ?desk|service desk|client services? (rep|representative|specialist|associate|coordinator)|technical support|tier [12] support|customer service)\b/i],
  ["data_analyst", /\b(data (analyst|engineer|analytics|specialist|manager|architect|scientist)|analytics (analyst|engineer|manager|specialist|lead)|business intelligence|bi (analyst|developer|engineer|manager)|reporting analyst|data & analytics|insights analyst|(financial|fp&a|pricing|inventory|supply chain|demand|forecast|revenue|sales|marketing|planning|procurement|logistics|risk|quality|performance) (planning )?analyst|analyst,? (data|analytics|reporting|operations|business intelligence))\b/i],
  ["ops_analyst", /\b(operations? analyst|business analyst|ops analyst|process analyst|operations (specialist|coordinator|associate)|business operations|operations (manager|lead)|program analyst|project analyst|management analyst)\b/i],
];

export function classifyTitle(title: string): JobFamily | null {
  const clean = title.replace(/\s+/g, " ").trim();
  if (!clean || EXCLUDE.test(clean)) return null;
  for (const [family, pattern] of RULES) {
    if (pattern.test(clean)) return family;
  }
  return null;
}

/** One sentence naming the work Nine-67 would do instead of the hires. Used as the signal's operating_need. */
export function operatingNeedFor(postings: Array<{ title: string; family: JobFamily | null }>) {
  const qualifying = postings.filter((posting): posting is { title: string; family: JobFamily } => posting.family !== null);
  if (!qualifying.length) return "";
  const families = [...new Set(qualifying.map((posting) => posting.family))];
  const titles = [...new Set(qualifying.map((posting) => posting.title))].slice(0, 3).join(", ");
  const count = qualifying.length;
  const what = families.map((family) => FAMILY_LABEL[family].toLowerCase()).join(", ");
  return count === 1
    ? `They are hiring a ${titles}; Nine-67 could build and run that ${what} work instead of the hire.`
    : `They are hiring ${count} roles in ${what} (${titles}); Nine-67 could build and run that work instead of adding headcount.`;
}
