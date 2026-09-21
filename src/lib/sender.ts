import type { SupabaseClient } from "@supabase/supabase-js";
import type { Owner } from "./types.ts";

/**
 * How the connected mailbox presents on an outreach email: a display name and
 * title on the From line (so a recipient sees a senior person, not a bare
 * address), a signature appended to the body, and a CC list. Stored per owner
 * slot; the mailbox address itself is the owner's Gmail connection.
 */
export type SenderProfile = { fromName: string; title: string; signature: string; website: string; location: string; cc: string[] };
const EMPTY: SenderProfile = { fromName: "", title: "", signature: "", website: "", location: "", cc: [] };

export async function senderProfile(db: SupabaseClient, owner: Owner): Promise<SenderProfile> {
  const { data } = await db.from("sender_profiles").select("from_name,title,signature,website,location,cc").eq("owner", owner).maybeSingle();
  if (!data) return EMPTY;
  return {
    fromName: (data.from_name as string | null) ?? "",
    title: (data.title as string | null) ?? "",
    signature: (data.signature as string | null) ?? "",
    website: (data.website as string | null) ?? "",
    location: (data.location as string | null) ?? "",
    cc: Array.isArray(data.cc) ? (data.cc as string[]) : [],
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const siteUrl = (site: string) => (site ? (/^https?:\/\//.test(site) ? site : `https://${site}`) : "");

/**
 * The only URL allowed to leave in outbound copy is the real Nine-67 homepage. Models can hallucinate
 * plausible-but-dead links (e.g. nine-67.com/case-study, /demo). This collapses ANY nine-67.com link —
 * whatever path or subdomain — to the canonical homepage, and strips links to any other domain entirely,
 * so a fabricated URL can never reach a prospect. `SENDER_SITE_URL` overrides the canonical link.
 */
export function sanitizeLinks(text: string): string {
  if (!text) return text;
  return text
    // No links in the body at all — the website already lives in the signature. Drop every URL (keeping any
    // trailing sentence punctuation) and every bare domain a model may have invented ("nine-67.com/x",
    // "acme.io/demo"), so a prospect never sees a duplicate or fabricated link in the message.
    .replace(/https?:\/\/[^\s<>)\]]+/gi, (raw) => raw.match(/[.,!?;:]+$/)?.[0] ?? "")
    .replace(/(^|[\s(])(?:[a-z0-9-]+\.)+(?:com|io|ai|co|net|org|dev|app|xyz|us|biz|info|me|tech|solutions)(\/[^\s<>)\]]*)?/gi, (_whole, pre: string) => pre)
    // Strip the leftover CTA some cached drafts still carry ("Want a free one-page teardown…"). Remove the
    // whole sentence containing "teardown" so nothing dangling is left.
    .replace(/[^.!?\n]*\bteardown\b[^.!?\n]*[.!?]?/gi, "")
    // No em/en dashes — they read as AI-written; use a comma. Only when spaced on BOTH sides, so number
    // ranges ("10–15", "$10–15M") and a "\n— Name" sign-off are left intact.
    .replace(/ +[—–] +/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
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
  if (isHtmlSignature(sig)) return `<div style="margin-top:24px">${sig}</div>`;
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
