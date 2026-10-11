/** Short, optimistic lines for the top of Overview. Original, so no one is misquoted. One a day, the same for everyone. */
export const THOUGHTS = [
  "Every great customer was a stranger once.",
  "One good conversation can change the whole month.",
  "The reply you're hoping for might already be on its way.",
  "Small, steady outreach adds up to big results.",
  "Today is a good day to start a new conversation.",
  "Someone out there has exactly the problem you solve.",
  "Every no gets you closer to the right yes.",
  "Curiosity opens more doors than any pitch.",
  "Momentum is built one email at a time.",
  "The best opportunities often start with a simple hello.",
  "You're one introduction away from something great.",
  "Consistency beats intensity. Show up again today.",
  "Good things grow from honest, helpful conversations.",
  "Each list is a fresh set of possibilities.",
  "A thoughtful message is a gift. Send a few today.",
  "Progress, not perfection. Keep going.",
  "Today's follow-up could be tomorrow's meeting.",
  "Great work compounds. So does great outreach.",
  "Be the most helpful voice in their inbox.",
  "You've done the hard part already. Now let it work.",
] as const;

/** The thought for a calendar day (YYYY-MM-DD), stepping through the list one day at a time. */
export function thoughtForDay(date: string): string {
  const days = Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
  return THOUGHTS[((days % THOUGHTS.length) + THOUGHTS.length) % THOUGHTS.length];
}
