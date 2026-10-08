/** What the desk says about the morning auto-send for one seat: plain words, and whether "Skip today" applies. */
export type AutoSendSeat = {
  autoSend: boolean; paused: boolean; pausedReason: string | null; postalAddressSet: boolean; skippedToday: boolean;
  sentToday: number; dailyCap: number;
  /** From the server, in SEND_TIMEZONE: whether today sends at all, the time now and the window, in minutes after midnight. */
  sendDay: boolean; minutesNow: number; sendFrom: number; sendUntil: number;
};

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};
const drafts = (count: number) => `${count} confirmed ${count === 1 ? "draft goes" : "drafts go"}`;

export function autoSendLine(seat: AutoSendSeat, confirmed: number): { text: string; canSkip: boolean } {
  const window = `${clock(seat.sendFrom)} to ${clock(seat.sendUntil)}`;
  if (!seat.autoSend) return { text: "Auto-send is off. Send all ready or Send email sends by hand.", canSkip: false };
  if (seat.paused) return { text: `Auto-send is paused${seat.pausedReason ? ` (${seat.pausedReason.replace(/\.\s*$/, "")})` : ""}. Resume it in Settings.`, canSkip: false };
  if (!seat.postalAddressSet) return { text: "Auto-send is on but needs a postal address in Settings before anything sends.", canSkip: false };
  if (!confirmed) return { text: "Auto-send is on. No confirmed drafts are waiting.", canSkip: false };
  const today = seat.sendDay && seat.minutesNow < seat.sendUntil;
  if (today && seat.skippedToday) return { text: `Auto-send is skipped today. ${drafts(confirmed)} out on the next send day, ${window}.`, canSkip: false };
  if (today) return { text: `Auto-send is on. ${drafts(confirmed)} out ${seat.minutesNow < seat.sendFrom ? "today" : "until"} ${seat.minutesNow < seat.sendFrom ? window : clock(seat.sendUntil)}, spaced apart.`, canSkip: true };
  return { text: `Auto-send is on. ${drafts(confirmed)} out on the next send day, ${window}.`, canSkip: false };
}

export function sentTodayLine(seat: Pick<AutoSendSeat, "sentToday" | "dailyCap">) {
  return `${seat.sentToday} of ${seat.dailyCap} sent today`;
}
