import data from "../../data/dossiers/index.json" with { type: "json" };

import focused from "../../data/dossiers/revenue-focus-index.json" with { type: "json" };
const all = [...focused, ...data];

export function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && ["", "."].includes(value.trim()));
}
const key = (value: string) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
export function accountBrief(domain?: string | null) { return all.find(row => domain && key(row.domain) === key(domain))?.brief; }
export function dossierFor(domain?: string | null) { return all.find(row => domain && key(row.domain) === key(domain))?.dossier; }
export function primaryFact(domain?: string | null) {
  const brief = accountBrief(domain);
  return dossierFor(domain)?.facts.find(fact => fact.fact_id === brief?.router_output.primary_signal_fact_id);
}
export function briefContact(domain: string | null | undefined, name: string | null | undefined) {
  return accountBrief(domain)?.contacts.find(person => `${person.first_name} ${person.last_name}`.toLowerCase().replace(/\s+/g, " ") === name?.trim().toLowerCase().replace(/\s+/g, " "));
}
export function compareAccounts(a: string, b: string, aName = "", bName = "") {
  const aa = accountBrief(a), bb = accountBrief(b);
  const strength = (domain: string) => Math.max(0, ...(dossierFor(domain)?.signals.map(signal => signal.strength) ?? []));
  return (aa?.send_wave ?? Infinity) - (bb?.send_wave ?? Infinity) || strength(b) - strength(a) || (aa?.company ?? aName).localeCompare(bb?.company ?? bName);
}
export function dateLabel(value: unknown): string | null {
  if (isBlank(value) || typeof value !== "string") return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
export function sourceDomain(value: unknown): string | null {
  if (isBlank(value) || typeof value !== "string") return null;
  try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.hostname.replace(/^www\./, "") : null; } catch { return null; }
}
export function capitalize(value: string) { return value.charAt(0).toUpperCase() + value.slice(1); }
