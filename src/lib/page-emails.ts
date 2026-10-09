/**
 * Every email address a page shows, including the ones sites hide from bots: HTML entities (&#64;),
 * percent-encoded mailto links and Cloudflare's email protection (data-cfemail), which is a published
 * address in reversible XOR form. Pure; the page has already been fetched.
 */

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Cloudflare's scheme: the first byte is the key, every following byte XOR the key is a character. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

const decodeEntities = (html: string) => html
  .replace(/&#(\d+);?/g, (_, code: string) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&(commat|period|nbsp|amp);/gi, (_, name: string) => ({ commat: "@", period: ".", nbsp: " ", amp: "&" })[name.toLowerCase()] ?? "");

/** The page as readable text with every hidden address put back where it was. */
export function revealEmails(html: string): string {
  let text = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, (block) => /cfemail|email-protection/i.test(block) ? "" : " ");
  // Cloudflare: <a href="/cdn-cgi/l/email-protection#HEX"> and <span data-cfemail="HEX">.
  text = text.replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (match, hex: string) => decodeCfEmail(hex) ?? match);
  text = text.replace(/data-cfemail="([0-9a-f]+)"[^>]*>[^<]*</gi, (match, hex: string) => { const email = decodeCfEmail(hex); return email ? `>${email}<` : match; });
  text = decodeEntities(text);
  text = text.replace(/mailto:([^"'\s>]+)/gi, (_, target: string) => { try { return `mailto:${decodeURIComponent(target)}`; } catch { return `mailto:${target}`; } });
  return text;
}

export type PageEmail = { email: string; before: string };

/** Each distinct address on the page at this domain, with the text just before its first appearance (where a name usually is). */
export function pageEmails(html: string, domain?: string): PageEmail[] {
  const text = revealEmails(html);
  const visible = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const seen = new Map<string, PageEmail>();
  for (const source of [visible, text]) {
    for (const match of source.matchAll(EMAIL)) {
      const email = match[0].toLowerCase().replace(/^mailto:/, "").replace(/\.$/, "");
      if (domain && !email.endsWith(`@${domain.toLowerCase()}`)) continue;
      if (seen.has(email)) continue;
      seen.set(email, { email, before: source === visible ? visible.slice(Math.max(0, (match.index ?? 0) - 160), match.index) : "" });
    }
  }
  return [...seen.values()];
}

/** True when the page shows this exact address, hidden or not. */
export function pageShowsAddress(html: string, address: string): boolean {
  const needle = address.toLowerCase();
  return html.toLowerCase().includes(needle) || pageEmails(html).some((item) => item.email === needle);
}
