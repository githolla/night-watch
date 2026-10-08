import type { Owner } from "./types.ts";

/**
 * Whose drafts a draft tool may touch. A member only ever their own seat's; an admin every seat's, or one seat
 * when the request names it. Applied as `.match(draftMatch(seat))`, which is a no-op for "every seat".
 */
export function draftSeat(user: { role: string; owner: Owner }, requested?: unknown): Owner | null {
  if (user.role !== "admin") return user.owner;
  return requested === "josh" || requested === "suuchi" ? requested : null;
}

export const draftMatch = (seat: Owner | null): Record<string, string> => (seat ? { assigned_to: seat } : {});
