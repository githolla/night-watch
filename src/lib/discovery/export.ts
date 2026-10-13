import type { DiscoveryOpportunity } from "./domain.ts";
export function evidenceCsv(rows: DiscoveryOpportunity[]) {
  const escape = (value: string) => `"${(/^[\s]*[=+@-]/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  const lines = [["Title", "Source", "URL", "Published", "Company", "Domain", "Stage", "Owner", "Evidence", "Unknowns", "Next step"], ...rows.map((row) => [row.item.title, row.item.provider, row.item.url, row.item.published_at ?? "unknown", row.company_name ?? "", row.company_domain ?? "", row.status, row.owner ?? "", row.assessment?.evidence.map((item) => item.quote).join(" | ") ?? "", row.assessment?.unknowns.join(" | ") ?? "", row.assessment?.next_step ?? "Review the original source"])];
  return lines.map((row) => row.map(escape).join(",")).join("\r\n");
}
