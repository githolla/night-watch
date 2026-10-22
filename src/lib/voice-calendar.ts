import { createInvite, checkedBusy } from "./calendar.ts";
import { ownerAccessToken } from "./gmail.ts";
import { admin } from "./supabase/admin.ts";
import { VOICE_BOOKING, voiceSlotAllowed, voiceSlotClear } from "./voice-booking.ts";

async function calendarToken() {
  const { data, error } = await admin().from("gmail_connections").select("email").eq("owner", VOICE_BOOKING.owner).single();
  if (error || data?.email?.toLowerCase() !== VOICE_BOOKING.calendar) throw new Error("Suuchi's connected calendar account does not match operations@nine-67.com.");
  return ownerAccessToken(VOICE_BOOKING.owner);
}

export async function voiceAvailability(start: string, end: string, prospectRequested: boolean) {
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < Date.now() || to <= from || to - from > 14 * 86_400_000) throw new Error("Choose a future search window of no more than 14 days.");
  const token = await calendarToken();
  const response = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: new Date(from - 15 * 60_000).toISOString(), timeMax: new Date(to + 15 * 60_000).toISOString(), items: [{ id: "primary" }] }),
  });
  if (!response.ok) throw new Error("Could not check Suuchi's calendar.");
  const busy = checkedBusy(await response.json());
  const slots: Array<{ start: string; end: string }> = [];
  for (let at = Math.ceil(from / 900_000) * 900_000; at + VOICE_BOOKING.durationMinutes * 60_000 <= to && slots.length < 8; at += 900_000) {
    const a = new Date(at).toISOString(), b = new Date(at + VOICE_BOOKING.durationMinutes * 60_000).toISOString();
    if (voiceSlotAllowed(a, b, prospectRequested) && voiceSlotClear(a, b, busy)) slots.push({ start: a, end: b });
  }
  return { slots, timeZone: VOICE_BOOKING.timeZone, durationMinutes: VOICE_BOOKING.durationMinutes };
}

export async function voiceBook(input: { start: string; email: string; prospectRequested: boolean; confirmed: boolean }, callId: string) {
  const end = new Date(Date.parse(input.start) + VOICE_BOOKING.durationMinutes * 60_000).toISOString();
  if (!input.confirmed) throw new Error("Confirm the prospect's email, date, time and time zone before booking.");
  if (!voiceSlotAllowed(input.start, end, input.prospectRequested)) throw new Error("That meeting conflicts with Suuchi's scheduling rules.");
  await calendarToken();
  return createInvite(VOICE_BOOKING.owner, {
    summary: "Nine-67: workflow conversation with Suuchi", start: input.start, end,
    timeZone: VOICE_BOOKING.timeZone, attendee: input.email,
    description: "15-minute workflow conversation with Suuchi at Nine-67, arranged by Nine-67.",
    bookingKey: `voice:${callId}:${input.start}:${input.email.toLowerCase()}`, bufferMinutes: 15,
  });
}
