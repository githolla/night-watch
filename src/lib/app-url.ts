/** The address links in emails point at. APP_URL wins when it is a real URL (stray spaces or a path pasted into
 *  Vercel are dropped); otherwise the address the request came in on. */
export function appBase(request: Request): string {
  const fallback = new URL(request.url).origin;
  const configured = process.env.APP_URL?.replace(/\s+/g, "");
  if (!configured) return fallback;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : fallback;
  } catch {
    return fallback;
  }
}
