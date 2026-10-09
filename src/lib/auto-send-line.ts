/** What the desk says about the morning auto-send for one seat: plain words, and whether "Skip today" applies. */
export type AutoSendSeat = {
  autoSend: boolean; paused: boolean; pausedReason: string | null; postalAddressSet: boolean; skippedToday: boolean;
  sentToday: number; dailyCap: number;
  /** From the server, in SEND_TIMEZONE: whether today sends at all, the time now and the window, in minutes after midnight. */
  sendDay: boolean; minutesNow: number; sendFrom: number; sendUntil: number;
  /** What the next window sends, from the morning run's own queue; missing when it could not be read. */
  nextSend?: { going: number; dayLabel: string; windowLabel: string } | null;
};

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const drafts = (count: number) => `${count} ${count === 1 ? "draft goes" : "drafts go"}`;

export function autoSendLine(seat: AutoSendSeat, waiting: number): { text: string; canSkip: boolean } {
  const window = `${clock(seat.sendFrom)} to ${clock(seat.sendUntil)}`;
  if (!seat.autoSend) return { text: "Nothing goes out unless you send it.", canSkip: false };
  if (seat.paused) return { text: `Auto-send is paused${seat.pausedReason ? ` (${seat.pausedReason.replace(/\.\s*$/, "")})` : ""}. Resume it in Settings.`, canSkip: false };
  if (!seat.postalAddressSet) return { text: "Auto-send is on but needs a postal address in Settings before anything sends.", canSkip: false };
  if (!waiting) return { text: "Auto-send is on. No drafts are waiting.", canSkip: false };
  const today = seat.sendDay && seat.minutesNow < seat.sendUntil;
  if (today && seat.skippedToday) return { text: `Auto-send is skipped today. ${drafts(waiting)} out on the next send day, ${window}.`, canSkip: false };
  if (today) return { text: `Auto-send is on. ${drafts(waiting)} out ${seat.minutesNow < seat.sendFrom ? "today" : "until"} ${seat.minutesNow < seat.sendFrom ? window : clock(seat.sendUntil)}, spaced apart.`, canSkip: true };
  return { text: `Auto-send is on. ${drafts(waiting)} out on the next send day, ${window}.`, canSkip: false };
}

export function sentTodayLine(seat: Pick<AutoSendSeat, "sentToday" | "dailyCap">) {
  return `${seat.sentToday} of ${seat.dailyCap} sent today`;
}
