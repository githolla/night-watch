import { safeFetch, onDomain, type Fetcher, type Lookup } from "./evidence-grounding.ts";
import { dialHref, type PhoneEvidence } from "./call-plan.ts";

export function publishedPhones(html: string, sourceUrl: string, now = new Date().toISOString()): PhoneEvidence[] {
  const visible = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const numbers = [...visible.matchAll(/<a\b[^>]*href\s*=\s*["']tel:([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].flatMap(match => {
    const before = visible.slice(Math.max(0, (match.index ?? 0) - 100), match.index ?? 0).replace(/<[^>]+>/g, " ");
    if (/\bfax\b/i.test(match[2]) || /\bfax\s*:?\s*$/i.test(before)) return [];
    let number: string;
    try { number = decodeURIComponent(match[1]).replace(/&amp;/g, "&").replace(/;ext=/i, " ext "); } catch { return []; }
    return dialHref(number) ? [{ number, kind: "company" as const, sourceUrl, checkedAt: now, notes: "Published on the company website. Ask to be transferred to the named contact; this is not a confirmed direct line." }] : [];
  });
  const text = visible.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  for (const match of text.matchAll(/(?:phone|telephone|call(?: us)?)\s*:?\s*(\+?1?[ (.-]*\d{3}[ ).-]*\d{3}[ .-]*\d{4})/gi)) {
    if (dialHref(match[1])) numbers.push({ number: match[1].trim(), kind: "company", sourceUrl, checkedAt: now, notes: "Published as a phone number on the company website; not a confirmed direct line." });
  }
  return [...new Map(numbers.map(phone => [dialHref(phone.number), phone])).values()];
}

export async function researchCompanyPhone(domain: string, deps: { fetcher?: Fetcher; lookup?: Lookup; signal?: AbortSignal } = {}): Promise<PhoneEvidence | null> {
  for (const path of ["/contact", "/contact-us", "/"]) {
    const page = await safeFetch(`https://${domain}${path}`, deps.fetcher, { lookup: deps.lookup, signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000), maxBytes: 1_500_000 });
    if (page.kind !== "page" || page.status !== 200 || !onDomain(page.finalUrl, domain)) continue;
    const phones = publishedPhones(page.html, page.finalUrl);
    if (phones.length === 1) return phones[0];
    // Multiple branch numbers need a person to choose the relevant location.
  }
  return null;
}
