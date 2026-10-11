import { requireUser } from "@/lib/auth";
import { logoDomain } from "@/lib/logo-domain";

const WEEK = 60 * 60 * 24 * 7;

/**
 * A company's logo by domain, from public icon services only (never the company's own site), so the
 * browser can cache it. A 404 means none was found and the page shows the company's initials instead.
 */
export async function GET(request: Request) {
  try { await requireUser(); } catch { return new Response(null, { status: 401 }); }
  const domain = logoDomain(new URL(request.url).searchParams.get("domain"));
  if (!domain) return new Response(null, { status: 400 });
  const sources = [`https://www.google.com/s2/favicons?domain=${domain}&sz=128`, `https://icons.duckduckgo.com/ip3/${domain}.ico`];
  for (const source of sources) {
    const response = await fetch(source, { signal: AbortSignal.timeout(4000), cache: "no-store" }).catch(() => null);
    const type = response?.headers.get("content-type") ?? "";
    if (!response?.ok || !type.startsWith("image/")) continue;
    return new Response(await response.arrayBuffer(), { headers: { "content-type": type, "cache-control": `private, max-age=${WEEK}, stale-while-revalidate=${WEEK}` } });
  }
  return new Response(null, { status: 404, headers: { "cache-control": `private, max-age=${60 * 60 * 24}` } });
}
