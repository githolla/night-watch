export const emailTones = {
  sales: { label: "Sales-focused", description: "Make the business value clear", instruction: "Make the commercial value of the existing proposal clear: what the leader gains and why a small first project is worth exploring. Connect the offer to their business, not generic sales automation. No invented ROI or pressure." },
  catchy: { label: "Catchy", description: "A memorable, specific opening", instruction: "Write a memorable opening using a concrete detail from this company and the existing business idea. Use crisp, plain language. No clickbait, gimmicks, fake urgency or vague teasers." },
  playful: { label: "Playful", description: "A little personality", instruction: "Use light, understated wit and natural contractions, like a sharp colleague. Keep the business idea serious and specific. No jokes at the recipient's expense, emojis, forced puns or exclamation marks." },
  cta: { label: "Strong CTA", description: "Make replying easy", instruction: "Build toward one clear, easy-to-answer final question tied to the existing offer. Offer a specific next step without demanding a meeting. Preserve the intent of the offer; sharpen the wording of the CTA. No multiple asks or pressure." },
  direct: { label: "Direct", description: "Get to the point", instruction: "Lead with the specific business implication. Short, decisive sentences and a straightforward question. Be confident without claiming an unverified problem." },
  warm: { label: "Warm", description: "Personal and conversational", instruction: "Sound like a thoughtful peer writing personally. Use natural contractions and approachable language. No fake familiarity, flattery or invented shared experience." },
  curious: { label: "Curious", description: "Invite their perspective", instruction: "Present the company-specific idea as a thoughtful hypothesis and invite their perspective. Use only one question, the final CTA. Avoid pretending to know their internal problems." },
  bold: { label: "Bold", description: "A sharper opening", instruction: "Open with a crisp, unexpected business implication supported by the supplied facts. Make the offer concrete and confident. No hype, urgency, fear, guarantees or invented numbers." },
} as const;
export type EmailTone = keyof typeof emailTones;
export function toneInstruction(tone: EmailTone): string {
  return `Rewrite in a ${tone} tone. ${emailTones[tone].instruction} Change the voice, not the recipient, factual claims, proof, proposed workflow or meaning of the CTA. Keep the subject unchanged. Preserve the Nine-67 introduction and AI-first positioning. No em or en dashes. End with the CTA question; no pleasantry or signature.`;
}
