/** How a reply reads, in the same words on Home, Replies and anywhere else a reply shows. */
export const REPLY_LABELS: Record<string, string> = { positive: "Interested", referral: "Referral", neutral: "Question", objection: "Pushback", negative: "Not interested" };

export function replyLabel(classification: string | null | undefined): string {
  return (classification && REPLY_LABELS[classification]) || "Replied";
}
