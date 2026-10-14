import { score, type DiscoveryOpportunity } from "./domain.ts";

export function companyPriorities(rows: DiscoveryOpportunity[], now: number) {
  const groups = new Map<string, DiscoveryOpportunity[]>();
  for (const row of rows) {
    if (!row.company_confirmed || !row.company_domain || !row.item.active || row.feedback === "irrelevant" || row.status === "dismissed" || (row.item.deadline && Date.parse(row.item.deadline) <= now) || now - Date.parse(row.checked_at) > 7 * 86400000) continue;
    const published = row.item.published_at ? Date.parse(row.item.published_at) : null;
    if (published !== null && (published > now || now - published > 30 * 86400000)) continue;
    const group = groups.get(row.company_domain) ?? [];
    const fingerprint = row.item.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (!group.some(old => old.item.text.toLowerCase().replace(/\s+/g, " ").trim() === fingerprint)) group.push(row);
    groups.set(row.company_domain, group);
  }
  return [...groups].map(([domain, signals]) => {
    signals.sort((a, b) => score(b, now) - score(a, now));
    const categories = [...new Set(signals.map(row => row.item.signal_category ?? row.item.kind))];
    const dated = signals.filter(row => row.item.published_at);
    const urgency = dated.length ? Math.min(100, Math.max(...dated.map(row => score(row, now))) + Math.min(15, (new Set(dated.map(row => row.item.signal_category ?? row.item.kind)).size - 1) * 5)) : 0;
    return { domain, company: signals[0].company_name || domain, signals, categories, urgency, dated: dated.length, nextStep: signals[0].assessment?.next_step || "Review the source and identify the relevant operating team.", label: urgency >= 60 ? "Research next" : dated.length ? "Recent context" : "Background context" };
  }).sort((a, b) => b.urgency - a.urgency || b.categories.length - a.categories.length || a.domain.localeCompare(b.domain));
}
