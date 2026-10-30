import { validVoiceTimezone } from "./voice-policy.ts";

const stateZones: Record<string, string> = {
  PA: "America/New_York", NJ: "America/New_York", NY: "America/New_York", CT: "America/New_York", MA: "America/New_York", RI: "America/New_York", VT: "America/New_York", NH: "America/New_York", ME: "America/New_York", OH: "America/New_York", MD: "America/New_York", DE: "America/New_York", DC: "America/New_York", VA: "America/New_York", WV: "America/New_York", NC: "America/New_York", SC: "America/New_York", GA: "America/New_York",
  IL: "America/Chicago", WI: "America/Chicago", MN: "America/Chicago", IA: "America/Chicago", MO: "America/Chicago", AR: "America/Chicago", LA: "America/Chicago", MS: "America/Chicago", AL: "America/Chicago", OK: "America/Chicago",
  CO: "America/Denver", UT: "America/Denver", WY: "America/Denver", MT: "America/Denver", AZ: "America/Phoenix", CA: "America/Los_Angeles", WA: "America/Los_Angeles", NV: "America/Los_Angeles", HI: "Pacific/Honolulu",
};

export function companyLocationTimezone(location: string): string | null {
  const region = location.match(/,\s*([A-Z]{2})(?:\s|$)/)?.[1];
  return region ? stateZones[region] ?? null : null;
}

export function companyPageTimezone(html: string): string | null {
  const text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  const regions = [...html.matchAll(/"addressRegion"\s*:\s*"([A-Z]{2})"/g)].map(match => match[1]);
  regions.push(...[...text.matchAll(/\b([A-Z]{2})\s+\d{5}(?:-\d{4})?\b/g)].map(match => match[1]));
  if (!regions.length || regions.some(region => !stateZones[region])) return null;
  const zones = new Set(regions.map(region => stateZones[region]));
  return zones.size === 1 ? [...zones][0] : null;
}

export type BusinessCallEvidence = { kind: string; number: string; auditedNumber: string; lineType: string; companySourceVerified: boolean; sourceUrl: string | null; checkedAt: string; timezone: string | null; timezoneSource: string | null };
export function businessCallEvidenceProblem(evidence: BusinessCallEvidence, now = new Date()): string | null {
  if (evidence.kind !== "company" || !evidence.companySourceVerified || !evidence.sourceUrl?.startsWith("https://")) return "Needs a published company number";
  if (evidence.number !== evidence.auditedNumber) return "Phone evidence belongs to another number";
  if (!["landline", "fixedVoip", "nonFixedVoip", "tollFree"].includes(evidence.lineType)) return "Not a confirmed business switchboard line type";
  const checked = Date.parse(evidence.checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() || now.getTime() - checked > 30 * 86_400_000) return "Company number evidence needs refreshing";
  if (!validVoiceTimezone(evidence.timezone) || !evidence.timezoneSource?.trim()) return "Needs a sourced company timezone";
  return null;
}
