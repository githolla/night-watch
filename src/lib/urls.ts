let warnedMissingAppUrl = false;

/**
 * The canonical base URL for links embedded in OUTBOUND email (unsubscribe, etc.). Prefer APP_URL — a
 * fixed, trusted value — so a spoofed Host header on the triggering request can't poison a link that ends
 * up in a prospect's inbox. Falls back to the request origin only when APP_URL is unset (with a one-time
 * warning), so a misconfigured deploy still functions instead of failing every send.
 */
export function outboundBaseUrl(request: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (!warnedMissingAppUrl) {
    warnedMissingAppUrl = true;
    console.warn("[night-watch] APP_URL is not set — outbound email links fall back to the (spoofable) request host. Set APP_URL to a fixed origin.");
  }
  return new URL(request.url).origin.replace(/\/$/, "");
}
