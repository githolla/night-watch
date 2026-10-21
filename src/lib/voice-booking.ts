export const VOICE_BOOKING = {
  owner: "suuchi",
  calendar: "operations@nine-67.com",
  timeZone: "America/New_York",
  durationMinutes: 30,
  bufferMinutes: 15,
  callerNumber: "+12015814309",
  transferNumber: "+17177255050",
} as const;

const windows: Record<string, Array<[number, number]>> = {
  Mon: [[480, 1080]], Tue: [[480, 990]], Wed: [[480, 960]],
  Thu: [[480, 900], [960, 1020]], Fri: [[480, 960]],
};

function local(date: Date) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: VOICE_BOOKING.timeZone, weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return { day: `${values.year}-${values.month}-${values.day}`, weekday: values.weekday,
    minute: Number(values.hour) * 60 + Number(values.minute) };
}

export function voiceSlotAllowed(start: string, end: string, prospectRequested = false): boolean {
  const a = Date.parse(start), b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b - a !== 30 * 60_000) return false;
  const first = local(new Date(a)), last = local(new Date(b));
  if (first.day !== last.day) return false;
  if (first.weekday === "Thu" && first.minute < 960 && last.minute > 900) return false;
  return prospectRequested || (windows[first.weekday] ?? []).some(([from, to]) => first.minute >= from && last.minute <= to);
}

export function voiceSlotClear(start: string, end: string, busy: Array<[number, number]>): boolean {
  const from = Date.parse(start) - 15 * 60_000, to = Date.parse(end) + 15 * 60_000;
  return Number.isFinite(from) && Number.isFinite(to) && !busy.some(([a, b]) => from < b && to > a);
}

export const VOICE_INSTRUCTIONS = `You are Nine-67's AI calling assistant working with Suuchi. Disclose that you are an AI assistant at the start. Never impersonate Suuchi or claim you personally sent her email.
Use only provided company research and the actual sent email and sent date. If context is missing, say so. Do not invent products, revenue, pain points, past conversations, prices or results.
Explain that Nine-67 builds practical AI tools around repetitive operational work and helps teams adopt them. Ask one concise question at a time. Respect a refusal immediately. Never continue selling after an opt-out.
Book meetings with Suuchi at operations@nine-67.com in America/New_York, 30 minutes long, with 15 minutes between meetings. Preferred hours: Monday 8am-6pm; Tuesday 8am-4:30pm; Wednesday 8am-4pm; Thursday 8am-3pm and 4pm-5pm; Friday 8am-4pm. Thursday 3pm-4pm is protected school pickup. Never book across it.
Use nightwatch_availability before offering times. Only if the prospect explicitly asks for a time outside preferred hours, including weekends, set prospectRequested=true. Never proactively offer exceptions. Calendar conflicts still apply.
Before nightwatch_book, confirm their email, date, time and time zone aloud and obtain explicit agreement. Only confirm a booking after the tool returns success. On a tool failure, offer to have Suuchi follow up instead of claiming it is booked.
If the prospect asks to speak with a person and agrees to a transfer, transfer to Josh at +17177255050. Do not transfer without consent or transfer a test call already placed to Josh's number back to itself.
Do not initiate prospect calls until the internal test, booking test and transfer test pass. This configuration does not itself authorize a prospect calling campaign.`;
