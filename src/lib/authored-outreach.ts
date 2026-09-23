import { recipientResearch, domainKey } from "./recipient-research.ts";
export { domainKey } from "./recipient-research.ts";
import companyDrafts from "../../data/customized-emails.json" with { type: "json" };
import additionalDrafts from "../../data/additional-outreach.json" with { type: "json" };

export type BuyerRole = "executive" | "finance" | "commercial" | "marketing" | "operations" | "engineering" | "security" | "people" | "general";
export type AuthoredVariant = { targetRole: string; subject: string; message: string; proofKind?: string };
export type AuthoredCompany = AuthoredVariant & { company: string; domain: string; alternate?: AuthoredVariant; variants?: AuthoredVariant[]; rationale?: string };
const rows = [...companyDrafts, ...additionalDrafts] as unknown as AuthoredCompany[];
const nameKey = (name: string) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const byDomain = new Map(rows.map(row => [domainKey(row.domain), row]));
const byName = new Map(rows.map(row => [nameKey(row.company), row]));
export function authoredCompany(company: string, domain?: string | null): AuthoredCompany | undefined {
  // A provided domain is authoritative: never fall back to a similarly named company on another domain.
  return domain ? byDomain.get(domainKey(domain)) : byName.get(nameKey(company));
}
const NEARBY: Record<BuyerRole, BuyerRole[]> = {
  executive: ["operations", "commercial", "finance"],
  finance: ["executive", "operations"],
  commercial: ["marketing", "executive", "operations"],
  marketing: ["commercial", "executive"],
  operations: ["executive", "engineering", "finance"],
  engineering: ["security", "operations", "executive"],
  security: ["engineering", "operations"],
  people: ["operations", "executive"],
  general: ["executive", "operations", "commercial"],
};
/** Select by buyer responsibility, never card ordering or an arbitrary word-rotation seed. */
export function authoredDraft(company: string, role: string, domain?: string | null, personName?: string | null): AuthoredVariant | undefined {
  const priority = recipientResearch(domain, personName);
  if (priority) return priority;
  const row = authoredCompany(company, domain);
  if (!row?.targetRole) return undefined;
  const variants = [row, ...(row.alternate ? [row.alternate] : []), ...(row.variants ?? [])];
  const priorities = [role, ...(NEARBY[role as BuyerRole] ?? NEARBY.general)];
  for (const audience of priorities) {
    const match = variants.find(variant => variant.targetRole === audience);
    if (match) return match;
  }
  // An unrelated specialist message is not a fallback for this recipient.
  return undefined;
}
