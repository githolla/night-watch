import { encrypt } from "./crypto.ts";

/** The plain reply-no line every cold email carries outside the curated lists. */
export function optOutLine() {
  return process.env.OPT_OUT_LINE ?? "If this isn't relevant, reply no and I won't follow up.";
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The visible footer and reply opt-out accompany the same signed URL as the mail header. */
export function withOptOut(delivery: { text: string; html: string }, curated: boolean, unsubscribe?: string) {
  const line = curated ? "" : optOutLine();
  const footer = unsubscribe ? `<p style="margin-top:20px"><a href="${escapeHtml(unsubscribe).replace(/"/g, "&quot;")}" style="display:inline-block;padding:8px 12px;border:1px solid #d6d3d1;border-radius:6px;color:#57534e;font:13px Arial,sans-serif;text-decoration:none">Unsubscribe</a></p>` : "";
  return {
    text: `${delivery.text}${line ? `\n\n${line}` : ""}${unsubscribe ? `\n\nUnsubscribe: ${unsubscribe}` : ""}`,
    html: `${delivery.html}${line ? `<p>${escapeHtml(line)}</p>` : ""}${footer}`,
  };
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

export function withTestOptOut(delivery: { text: string; html: string }, base: string) {
  return withOptOut(delivery, true, `${base.replace(/\/$/, "")}/api/unsubscribe/preview`);
}
