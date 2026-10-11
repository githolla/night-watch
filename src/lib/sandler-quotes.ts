/** Short Sandler rules for the morning briefing, credited to David Sandler. One a day, the same for everyone. */
export const SANDLER_RULES = [
  "You have to learn to fail, to win.",
  "Don't spill your candy in the lobby.",
  "Never answer an unasked question.",
  "No mutual mystification.",
  "The bottom line of professional selling is going to the bank.",
  "A decision not to make a decision is a decision.",
  "You can't sell anybody anything. They must discover they want it.",
  "The professional does what he did as a dummy, on purpose.",
  "Don't paint seagulls in your prospect's picture.",
  "The problem the prospect brings you is never the real problem.",
  "Never help the prospect end the interview.",
  "People buy emotionally and make decisions intellectually.",
  "Don't buy back tomorrow the product you sold today.",
  "No pain, no sale.",
  "There are no bad prospects, only bad salespeople.",
  "Close the sale or close the file.",
  "The best sales presentation you'll ever give, the prospect will never see.",
] as const;

/** The rule for a calendar day (YYYY-MM-DD), stepping through the list one day at a time. */
export function ruleForDay(date: string): string {
  const days = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
  return SANDLER_RULES[((days % SANDLER_RULES.length) + SANDLER_RULES.length) % SANDLER_RULES.length];
}
