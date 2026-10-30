import { excludedCompanyPhone } from "./company-phone-safety.ts";
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

const cityZones: Array<[string, string, string]> = [
  ["FL", "Miami|Orlando|Tampa|Jacksonville|Jupiter|West Palm Beach|Fort Lauderdale|Clearwater|Sarasota|Fort Myers|Tallahassee|Groveland", "America/New_York"],
  ["FL", "Pensacola|Panama City|Destin", "America/Chicago"],
  ["TX", "Dallas|Austin|Houston|San Antonio|Fort Worth|Carrollton|Spring|The Woodlands", "America/Chicago"],
  ["TX", "El Paso", "America/Denver"],
  ["TN", "Nashville|Memphis|Franklin|Brentwood|Murfreesboro", "America/Chicago"],
  ["TN", "Knoxville|Chattanooga|Johnson City", "America/New_York"],
  ["MI", "Detroit|Ann Arbor|Wixom|Troy|Livonia|Grand Rapids|Lansing|Rochester Hills", "America/New_York"],
  ["IN", "Indianapolis|Fort Wayne|Warsaw|South Bend|Bloomington", "America/Indiana/Indianapolis"],
  ["KS", "Wichita|Topeka|Overland Park|Kansas City", "America/Chicago"],
  ["NE", "Omaha|Lincoln", "America/Chicago"],
  ["OR", "Portland|Eugene|Salem|Bend", "America/Los_Angeles"],
  ["ID", "Boise|Meridian|Idaho Falls|Pocatello", "America/Boise"],
];
const regionNames: Record<string, string> = { California: "CA", Colorado: "CO", Pennsylvania: "PA", "New Jersey": "NJ", "New York": "NY", Massachusetts: "MA", Illinois: "IL", Wisconsin: "WI", Minnesota: "MN", Maryland: "MD", Virginia: "VA", "North Carolina": "NC", "South Carolina": "SC", Georgia: "GA", Alabama: "AL", Ohio: "OH", Florida: "FL", Texas: "TX", Tennessee: "TN", Michigan: "MI", Indiana: "IN" };
export function companyPageTimezone(html: string): string | null {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  for (const [name, abbreviation] of Object.entries(regionNames)) text = text.replaceAll(name, abbreviation);
  for (const object of html.matchAll(/\{[^{}]*"addressRegion"\s*:\s*"[^"\n]+"[^{}]*\}/g)) {
    try {
      const address: unknown = JSON.parse(object[0]);
      if (address && typeof address === "object" && "addressLocality" in address && "addressRegion" in address && typeof address.addressLocality === "string" && typeof address.addressRegion === "string") text += ` ${address.addressLocality}, ${regionNames[address.addressRegion] ?? address.addressRegion}`;
    } catch { continue; }
  }
  const regions = [...html.matchAll(/"addressRegion"\s*:\s*"([^"\n]+)"/g)].map(match => regionNames[match[1]] ?? match[1]);
  regions.push(...[...text.matchAll(/\b([A-Z]{2})\s*\d{5}(?:-\d{4})?\b/g)].map(match => match[1]));
  if (!regions.length) return null;
  const zones = new Set<string>();
  for (const region of regions) {
    if (stateZones[region]) { zones.add(stateZones[region]); continue; }
    const candidates = cityZones.filter(([state, cities]) => state === region && new RegExp(`\\b(?:${cities}),?\\s+${state}\\b`, "i").test(text));
    if (!candidates.length) return null;
    for (const [, , zone] of candidates) zones.add(zone);
  }
  return zones.size === 1 ? [...zones][0] : null;
}

export type BusinessCallEvidence = { kind: string; number: string; auditedNumber: string; lineType: string; companySourceVerified: boolean; sourceUrl: string | null; checkedAt: string; timezone: string | null; timezoneSource: string | null };
export function businessCallEvidenceProblem(evidence: BusinessCallEvidence, now = new Date()): string | null {
  if (excludedCompanyPhone(evidence.number)) return "Public emergency or crisis service is not a company switchboard";
  if (evidence.kind !== "company" || !evidence.companySourceVerified || !evidence.sourceUrl?.startsWith("https://")) return "Needs a published company number";
  if (evidence.number !== evidence.auditedNumber) return "Phone evidence belongs to another number";
  if (!["landline", "fixedVoip", "nonFixedVoip", "tollFree"].includes(evidence.lineType)) return "Not a confirmed business switchboard line type";
  const checked = Date.parse(evidence.checkedAt);
  if (!Number.isFinite(checked) || checked > now.getTime() || now.getTime() - checked > 30 * 86_400_000) return "Company number evidence needs refreshing";
  if (!validVoiceTimezone(evidence.timezone) || !evidence.timezoneSource?.trim()) return "Needs a sourced company timezone";
  return null;
}
