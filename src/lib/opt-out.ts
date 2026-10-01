import { encrypt } from "./crypto.ts";

/** The plain reply-no line every cold email carries outside the curated lists. */
export function optOutLine() {
  return process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Append the opt-out line to both parts. Curated list copy was written to end on its question, so those
 * domains rely on the List-Unsubscribe header alone, exactly as the first email does.
 */
export function withOptOut(delivery: { text: string; html: string }, curated: boolean) {
  if (curated) return delivery;
  const line = optOutLine();
  return { text: `${delivery.text}\n\n${line}`, html: `${delivery.html}<p>${escapeHtml(line)}</p>` };
}

/** RFC 8058 one-click target. The token is the encrypted person id read by /api/unsubscribe. */
export function unsubscribeUrl(base: string, personId: string) {
  return `${base.replace(/\/$/, "")}/api/unsubscribe?t=${encodeURIComponent(encrypt(personId))}`;
}

/** Base URL for links in mail sent without a browser request (crons): APP_URL, else Vercel's production host. */
export function configuredBaseUrl() {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  throw new Error("APP_URL is not set, so the unsubscribe link cannot be built. Nothing was sent.");
}
