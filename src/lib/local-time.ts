/** Wall-clock date and time in the operators' zone (SEND_TIMEZONE, default America/New_York). */
export function localParts(now: Date = new Date(), timeZone: string = process.env.SEND_TIMEZONE ?? "America/New_York") {
  let values: Record<string, string>;
  try {
    values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((part) => [part.type, part.value]));
  } catch {
    return localParts(now, "UTC");
  }
  const hour = Number(values.hour) % 24, minute = Number(values.minute);
  return { date: `${values.year}-${values.month}-${values.day}`, hour, minute, minutes: hour * 60 + minute };
}
