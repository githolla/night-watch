/** Pure rules for the morning auto-send, kept free of app imports so they can be tested directly. */

const hhmm = (name: string, fallback: number) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(process.env[name]?.trim() ?? "");
  return match ? Math.min(23 * 60 + 59, Number(match[1]) * 60 + Number(match[2])) : fallback;
};

/** Local times (minutes after midnight in SEND_TIMEZONE) and the bounce brake. Times are HH:MM env overrides. */
export const MORNING = {
  announceAt: hhmm("LIST_ANNOUNCE_AT", 7 * 60),
  sendFrom: hhmm("AUTO_SEND_FROM", 9 * 60),
  sendUntil: hhmm("AUTO_SEND_UNTIL", 11 * 60 + 30),
  // 20 sends before the rate counts, so a single stray bounce early in the day cannot pause the morning.
  runEveryMinutes: 10, bounceRate: 0.05, bounceMinSends: 20,
};

/** How many to send this run so the rest spread evenly over the remaining window. */
export function paceForRun(remaining: number, minutesNow: number, sendUntil = MORNING.sendUntil, every = MORNING.runEveryMinutes) {
  if (remaining <= 0 || minutesNow >= sendUntil) return 0;
  const runsLeft = Math.max(1, Math.ceil((sendUntil - minutesNow) / every));
  return Math.ceil(remaining / runsLeft);
}

/** Pause when more than 5% of today's sends bounced, once there are enough sends for the rate to mean something. */
export function bounceBrake(sentToday: number, bouncedToday: number) {
  return sentToday >= MORNING.bounceMinSends && bouncedToday / sentToday > MORNING.bounceRate;
}

/** Why auto-send will not run for this seat, or null when it will. */
export function autoSendBlocker(seatState: { autoSend: boolean; paused: boolean; postalAddress: string }) {
  if (!seatState.autoSend) return "auto-send is off";
  if (seatState.paused) return "auto-send is paused";
  if (!seatState.postalAddress) return "no postal address is set for the email footer";
  return null;
}

