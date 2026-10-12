import { logoDomain } from "./logo-domain.ts";

const DAY_MS = 86_400_000;
const found = new Map<string, { url: string | null; at: number }>();
const source = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

/** PNG width from the IHDR header, or 0 when it isn't a PNG. */
function pngWidth(bytes: Uint8Array): number {
  const signature = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || signature.some((byte, index) => bytes[index] !== byte)) return 0;
  return ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
}

/**
 * A public logo URL for a company, or null when it has none. Mail apps can't fall back when an image is missing,
 * so the email only shows a logo checked here first: Google answers 404 with a stand-in globe when it has no icon,
 * and a 16px icon stretched to 64 looks blurry, so both count as none. Cached for a day per server instance.
 */
export async function logoUrl(raw: string | null | undefined, fetcher: typeof fetch = fetch): Promise<string | null> {
  const domain = logoDomain(raw);
  if (!domain) return null;
  const hit = found.get(domain);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.url;
  const response = await fetcher(source(domain), { signal: AbortSignal.timeout(4000) }).catch(() => null);
  let url: string | null = null;
  if (response?.ok && (response.headers.get("content-type") ?? "").startsWith("image/")) {
    const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (pngWidth(bytes) >= 32) url = source(domain);
  } else {
    await response?.body?.cancel().catch(() => undefined);
  }
  // A failed lookup (timeout, network) is not remembered, so the next email tries again.
  if (url || response) found.set(domain, { url, at: Date.now() });
  return url;
}

/** Sets `logo` on each row whose company has one; the email shows initials for the rest. */
export async function addLogos(rows: Array<{ domain: string; logo?: string | null }>, fetcher: typeof fetch = fetch): Promise<void> {
  const domains = [...new Set(rows.map((row) => row.domain).filter(Boolean))];
  const urls = new Map(await Promise.all(domains.map(async (domain) => [domain, await logoUrl(domain, fetcher)] as const)));
  for (const row of rows) row.logo = urls.get(row.domain) ?? null;
}
