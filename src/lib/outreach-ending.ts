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

export function outreachEmailHtml(body: string, profile: SignatureSettings): string {
  const text = withOutreachName(body, profile).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<div style="font:400 14px/1.65 Arial,Helvetica,sans-serif;color:#1a1712">${text.replace(/\n/g, "<br>")}</div>`;
}
