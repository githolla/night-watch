import type { SupabaseClient } from "@supabase/supabase-js";
import type { Owner } from "./types.ts";
import { dedupeParagraphs, similarText, sanitizeSignatureHtml } from "./clean.ts";

/**
 * How the connected mailbox presents on an outreach email: a display name and
 * title on the From line (so a recipient sees a senior person, not a bare
 * address), a signature appended to the body, and a CC list. Stored per owner
 * slot; the mailbox address itself is the owner's Gmail connection.
 */
export type SenderProfile = { fromName: string; title: string; signature: string; website: string; location: string; cc: string[]; greeting: string; signoff: string };
/** What a seat that has set nothing gets. Kept here so the writer and the settings form agree. */
export const DEFAULT_GREETING = "Hi {first},";
export const DEFAULT_SIGNOFF = "Thank you,";
const EMPTY: SenderProfile = { fromName: "", title: "", signature: "", website: "", location: "", cc: [], greeting: DEFAULT_GREETING, signoff: DEFAULT_SIGNOFF };

export async function senderProfile(db: SupabaseClient, owner: Owner): Promise<SenderProfile> {
  // select("*") rather than a column list: greeting and signoff are added by a repair script the operator
  // runs by hand, and naming a column that does not exist yet fails the whole read — which would take the
  // sender's name and signature off every email until the SQL was applied.
  const { data } = await db.from("sender_profiles").select("*").eq("owner", owner).maybeSingle();
  if (!data) return EMPTY;
  return {
    fromName: (data.from_name as string | null) ?? "",
    title: (data.title as string | null) ?? "",
    signature: (data.signature as string | null) ?? "",
    website: (data.website as string | null) ?? "",
    location: (data.location as string | null) ?? "",
    cc: Array.isArray(data.cc) ? (data.cc as string[]) : [],
    greeting: ((data.greeting as string | null) ?? "").trim() || DEFAULT_GREETING,
    signoff: ((data.signoff as string | null) ?? "").trim() || DEFAULT_SIGNOFF,
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const siteUrl = (site: string) => (site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : "");

export { dedupeParagraphs, similarText };

/**
 * The last pass over any outbound message body. Collapses a repeated opener, removes every link (the
 * website belongs in the signature, not the body), drops the retired "teardown" CTA, and normalizes
 * dashes and whitespace — so none of those can reach a prospect however the draft was produced.
 */
export function sanitizeLinks(text: string): string {
  if (!text) return text;
  // Our own domain, so we can tell "our link" (remove — it's already in the signature) from a prospect's
  // domain mentioned in a sentence (keep — deleting it mangles their copy).
  let canonHost = "nine-67.com";
  try { canonHost = new URL((process.env.SENDER_SITE_URL || "https://nine-67.com").trim()).hostname.replace(/^www\./, ""); } catch { /* keep default */ }
  // (?<![@\w.]) so an email address keeps its domain — "Reach me at josh@nine-67.com" must not become "josh@".
  const ourLink = new RegExp(`(?<![@\\w.])(?:https?://)?(?:[a-z0-9-]+\\.)*${canonHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:/\\S*)?`, "gi");
  const cleaned = text
    // Our own link only — it duplicates the signature, and this also catches an invented path on our domain
    // ("nine-67.com/case-study"). A prospect's own domain, an email address, and any other link are the
    // sender's words and are left exactly as written.
    .replace(ourLink, "")
    // The one retired CTA, matched as the actual phrase rather than any sentence containing "teardown" —
    // that word has ordinary uses ("a teardown of your competitor's funnel") and the broad rule was deleting
    // real sentences, sometimes the whole email.
    .replace(/[^.!?\n]*\bone[- ]page teardown\b[^.!?\n]*[.!?]/gi, "")
    // No em/en dashes — they read as AI-written; use a comma. Only when spaced on BOTH sides, so number
    // ranges ("10–15", "$10–15M") and a "\n— Name" sign-off are left intact.
    .replace(/ +[—–] +/g, ", ")
    .replace(/,\s*,/g, ",")
    // Same-line only: a \s+ here used to pull a stray "." onto the previous paragraph ("promised:.").
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  // Never hand back an empty body: if the rules would erase everything, the original is the safer answer.
  return cleaned || text.trim();
}

/** True when the signature field holds real HTML (an uploaded/pasted signature) rather than plain text. */
export function isHtmlSignature(signature: string): boolean {
  return /<[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(signature.trim());
}

/** Flatten an HTML signature to readable plain text for the text/plain part of the email. */
function htmlSignatureToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|tr|table|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#8209;/gi, "-")
    .replace(/[ \t]+/g, " ").replace(/ *\n{3,}/g, "\n\n").replace(/[ \t]+\n/g, "\n").trim();
}

/** The branded Nine-67 signature block, email-safe (inline styles, table layout). An uploaded HTML
 *  signature wins outright; otherwise the structured name builds the block, or the free-text is a fallback. */
export function renderSignatureHtml(profile: SenderProfile, email: string): string {
  // A signature the admin uploaded/pasted as HTML is used verbatim — it IS the signature, so it takes
  // precedence over the built-in block (that's the point of uploading your own).
  const sig = profile.signature.trim();
  // Sanitized again at render, not only on write, so a signature stored before that guard existed is safe too.
  if (isHtmlSignature(sig)) return `<div style="margin-top:24px">${sanitizeSignatureHtml(sig)}</div>`;
  if (!profile.fromName.trim()) return sig ? esc(sig).replace(/\n/g, "<br>") : "";
  const rows: string[] = [];
  if (email) rows.push(`<div style="margin-top:3px;font:400 15px Arial,Helvetica,sans-serif;color:#3a352f">✉&nbsp;&nbsp;<a href="mailto:${esc(email)}" style="color:#3a352f;text-decoration:none">${esc(email)}</a></div>`);
  if (profile.website.trim()) rows.push(`<div style="font:400 15px Arial,Helvetica,sans-serif;color:#3a352f">◎&nbsp;&nbsp;<a href="${esc(siteUrl(profile.website.trim()))}" style="color:#3a352f;text-decoration:none">${esc(profile.website.trim())}</a></div>`);
  if (profile.location.trim()) rows.push(`<div style="font:400 15px Arial,Helvetica,sans-serif;color:#3a352f">⌖&nbsp;&nbsp;${esc(profile.location.trim())}</div>`);
  return `<table cellpadding="0" cellspacing="0" style="margin-top:28px"><tr>
    <td style="vertical-align:top;padding-right:30px;border-right:2px solid #c9c2b6"><span style="font:800 48px Arial,Helvetica,sans-serif;color:#9a8258;letter-spacing:-1px;white-space:nowrap">Nine&#8209;67</span></td>
    <td style="vertical-align:top;padding-left:30px">
      <div style="font:600 30px Georgia,'Times New Roman',serif;color:#1a1712;letter-spacing:-.3px">${esc(profile.fromName.trim())}</div>
      ${profile.title.trim() ? `<div style="font:600 13px Arial,Helvetica,sans-serif;letter-spacing:3px;text-transform:uppercase;color:#8a8378;margin-top:5px">${esc(profile.title.trim())}</div>` : ""}
      <div style="margin-top:14px;line-height:1.9">${rows.join("")}</div>
    </td></tr></table>`;
}

/** The full HTML email: the message (line breaks preserved), the branded signature, then the opt-out line. */
export function emailHtml(body: string, profile: SenderProfile, email: string, optOut: string): string {
  const bodyHtml = esc(body.trim()).replace(/\n/g, "<br>");
  const sig = renderSignatureHtml(profile, email);
  const foot = optOut ? `<div style="margin-top:16px;color:#8a8378;font:400 12px Arial,Helvetica,sans-serif">${esc(optOut)}</div>` : "";
  return `<div style="font:400 14px/1.65 Arial,Helvetica,sans-serif;color:#1a1712">${bodyHtml}${sig}${foot}</div>`;
}

/** Plain-text signature (for the text/plain part and for callers that don't send HTML). */
export function renderSignatureText(profile: SenderProfile, email: string): string {
  const sig = profile.signature.trim();
  // An uploaded HTML signature can't go in the text/plain part raw — flatten its tags to readable text.
  if (isHtmlSignature(sig)) return htmlSignatureToText(sig);
  if (!profile.fromName.trim()) return sig;
  const lines = [profile.fromName.trim(), profile.title.trim(), email, profile.website.trim(), profile.location.trim()].filter(Boolean);
  return lines.join("\n");
}

/** The Gmail From header value: `Name, Title <email>` when a name is set, otherwise the bare address. */
export function fromHeader(profile: SenderProfile, email: string) {
  const label = [profile.fromName, profile.title].filter((part) => part.trim()).join(", ").replace(/[\r\n]/g, "").trim();
  if (!label) return email;
  // RFC 5322: a display name containing a comma (our default "Name, Title") or other specials must be a
  // quoted-string, or strict parsers read it as two addresses and garble the sender.
  const needsQuote = /[",:;<>@()[\]\\]/.test(label);
  return needsQuote ? `"${label.replace(/"/g, "'")}" <${email}>` : `${label} <${email}>`;
}

/** Plain-text body with the signature appended once; the caller adds the opt-out line after this. */
export function withSignature(body: string, profile: SenderProfile, email = "") {
  const sig = renderSignatureText(profile, email);
  return sig ? `${body.trim()}\n\n${sig}` : body.trim();
}
