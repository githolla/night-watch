import { sanitizeSignatureHtml, decodeEntities } from "./clean.ts";
import { emailFirstName } from "./email-style.ts";

type SignatureSettings = { fromName: string; signature?: string };

/** Outreach uses the name saved in sender settings, never a mailbox-derived identity. */
export function senderFirstName(profile: SignatureSettings): string {
  const signatureText = (profile.signature ?? "")
    .replace(/<br\s*\/?>|<\/(?:div|p|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ");
  const name = profile.fromName.trim() || signatureText.split(/\r?\n/)
    .map(line => line.trim()).find(line => line && !/^(?:thank you|thanks|best(?: regards)?|regards)[,!]?$/i.test(line)) || "";
  return name ? emailFirstName(name) : "";
}

/** Stored body stops at the final CTA. The sender name belongs to presentation/send. */
export function outreachBody(body: string): string {
  const lines = body.trim().split(/\r?\n/);
  const cta = lines.findLastIndex(line => /\?\s*$/.test(line));
  if (cta >= 0) return lines.slice(0, cta + 1).join("\n").trim();
  // Do not invent a CTA or discard a body when migrating an older draft without one.
  while (lines.length && (!lines.at(-1)?.trim() || /^(?:thank you|thanks|best(?: regards)?|regards)[,!]?$/i.test(lines.at(-1)!.trim()))) lines.pop();
  return lines.join("\n").trim();
}

export function withOutreachName(body: string, profile: SignatureSettings): string {
  const name = senderFirstName(profile);
  return [outreachBody(body), name].filter(Boolean).join("\n\n");
}

/** Only the explicitly saved footer is appended; do not invent a branded block. */
export function outreachFooterHtml(profile: SignatureSettings): string {
  const signature = profile.signature?.trim() ?? "";
  if (!signature) return "";
  if (/<[a-z][a-z0-9-]*(\s[^>]*)?\/?>/i.test(signature)) return sanitizeSignatureHtml(signature).replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "").replace(/<!doctype[^>]*>|<\/?(?:html|body)\b[^>]*>/gi, "");
  return signature.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

/** Plain-text alternative of the same saved signature, including contact details. */
export function signatureText(profile: SignatureSettings): string {
  return outreachFooterHtml(profile).replace(/<br\s*\/?>|<\/?(?:div|p|tr|table)\b[^>]*>/gi, "\n").replace(/<\/td>/gi," ").replace(/<[^>]*>/g, "")
    .split("\n").map(line => decodeEntities(decodeEntities(line)).trim()).filter(Boolean).join("\n");
}
export function withOutreachSignature(body: string, profile: SignatureSettings): string {
  return [withOutreachName(body, profile), signatureText(profile)].filter(Boolean).join("\n\n");
}
/** Both real sends and self-tests call this exact assembler. */
export function outreachDelivery(body: string, profile: SignatureSettings) {
  return { text: withOutreachSignature(body, profile), html: outreachEmailHtml(body, profile) };
}

export function outreachEmailHtml(body: string, profile: SignatureSettings): string {
  const text = withOutreachName(body, profile).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linked = text.replace(/https:\/\/night-watch-snowy\.vercel\.app\/gift\/[a-f0-9]{32}(?:\?t=[a-zA-Z0-9_.-]+)?/g, url => `<a href="${url}">Read your one-page brief</a>`);
  const footer = outreachFooterHtml(profile);
  return `<div style="font:400 14px/1.6 Arial,Helvetica,sans-serif;color:#1a1712">${linked.replace(/\n/g, "<br>")}${footer ? `<div style="margin-top:24px">${footer}</div>` : ""}</div>`;
}
