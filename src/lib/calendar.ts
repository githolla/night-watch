import { createHash } from "node:crypto";
import { ownerAccessToken } from "./gmail.ts";
import type { Owner } from "./types.ts";

const CAL = "https://www.googleapis.com/calendar/v3";
export type Slot = { start: string; end: string; label: string };

// --- timezone helpers (Intl-based, so business hours land correctly across DST) ---
function parts(value: Date, timeZone: string) {
  const map = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short", hourCycle: "h23" }).formatToParts(value).map((p) => [p.type, p.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day), hour: Number(map.hour), minute: Number(map.minute), weekday: map.weekday as string };
}
/** The exact UTC instant for a given local wall-clock time in a zone. */
function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(desired);
  for (let pass = 0; pass < 2; pass++) {
    const seen = parts(guess, timeZone);
    const represented = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess = new Date(guess.getTime() + desired - represented);
  }
  return guess;
}

/** Propose a few open meeting slots from the owner's calendar: business-hour starts over the next several
 *  weekdays, minus anything busy. Read-only (free/busy), so it never touches events. */
export async function proposeTimes(owner: Owner, opts: { durationMins?: number; count?: number; days?: number; timeZone?: string; hours?: number[] } = {}): Promise<{ slots: Slot[]; timeZone: string }> {
  const duration = opts.durationMins ?? 30;
  const count = opts.count ?? 3;
  const days = opts.days ?? 8;
  const timeZone = opts.timeZone ?? "America/New_York";
  const hours = opts.hours ?? [10, 13, 15]; // local start hours to offer

  const now = new Date();
  const token = await ownerAccessToken(owner);
  const res = await fetch(`${CAL}/freeBusy`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + (days + 2) * 86_400_000).toISOString(), timeZone, items: [{ id: "primary" }] }),
  });
  if (!res.ok) throw new Error(res.status === 403 ? "Calendar access wasn't granted for this account — reconnect and allow Calendar." : `Calendar free/busy failed: ${res.status}`);
  const json = (await res.json()) as { calendars?: { primary?: { busy?: Array<{ start: string; end: string }> } } };
  const busy = checkedBusy(json);
  const clashes = (start: number, end: number) => busy.some(([bs, be]) => start < be && end > bs);

  const slots: Slot[] = [];
  const label = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const zoneAbbrev = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
  for (let d = 0; d < days + 2 && slots.length < count; d++) {
    const probe = new Date(now.getTime() + d * 86_400_000);
    const local = parts(probe, timeZone);
    if (["Sat", "Sun"].includes(local.weekday)) continue;
    for (const hour of hours) {
      if (slots.length >= count) break;
      const start = zoned(local.year, local.month, local.day, hour, 0, timeZone);
      if (start.getTime() <= now.getTime() + 3_600_000) continue; // at least an hour out
      const end = new Date(start.getTime() + duration * 60_000);
      if (clashes(start.getTime(), end.getTime())) continue;
      slots.push({ start: start.toISOString(), end: end.toISOString(), label: `${label.format(start)} ${zoneAbbrev}` });
    }
  }
  return { slots, timeZone };
}

const WEEKDAYS: Record<string, string> = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
/** Which offered slot a reply agrees to — conservative: needs at least two matching cues (weekday, date, time)
 *  and a single clear winner, so an ambiguous "yes" never books the wrong time. Returns null when unsure. */
export function matchProposedSlot(reply: string, slots: Slot[], now = Date.now()): Slot | null {
  const text = reply.split(/\n\s*(?:>|On .+wrote:|[-]+\s*Original Message)/i)[0].toLowerCase().replace(/[’‘]/g, "'");
  if (/\b(?:not|no|cannot|can\x27t|doesn\x27t|don\x27t|won\x27t|maybe|perhaps|tentative|instead|another|unavailable|unable|busy|reschedule|cancel)\b|\?/.test(text)) return null;
  if (!/\b(?:works?|perfect|confirm(?:ed)?|agreed|book|yes|see you|sounds good)\b/.test(text)) return null;
  const tight = text.replace(/\s/g, "");
  const scored = slots.filter(slot => Date.parse(slot.start) > now && Date.parse(slot.end) > Date.parse(slot.start)).map((slot) => {
    const label = slot.label.toLowerCase();
    const wd = label.match(/\b(mon|tue|wed|thu|fri|sat|sun)/)?.[0];
    const day = label.match(/\b(\d{1,2})\b/)?.[0];
    const time = label.match(/\d{1,2}(:\d{2})?\s?(am|pm)/)?.[0]?.replace(/\s/g, "");
    let score = 0;
    if (wd && (text.includes(wd) || text.includes(WEEKDAYS[wd]))) score++;
    if (day && new RegExp(`\\b${day}(st|nd|rd|th)?\\b`).test(text)) score++;
    if (time && (tight.includes(time) || tight.includes(time.replace(":00", "")))) score++;
    return { slot, score };
  }).sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) >= 2 && (scored.length < 2 || scored[0].score > scored[1].score)) return scored[0].slot;
  return null;
}

/** Create a calendar invite for a chosen slot and email the attendee (with a Google Meet link). */
export async function createInvite(owner: Owner, opts: { summary: string; description?: string; start: string; end: string; timeZone: string; attendee: string; bookingKey?: string }) {
  const token = await ownerAccessToken(owner);
  const eventId = opts.bookingKey ? createHash('sha256').update(`${owner}:${opts.bookingKey}`).digest('hex') : undefined;
  const existing = async () => {
    const response = await fetch(`${CAL}/calendars/primary/events/${eventId}`, {signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`}});
    if(response.status===404)return null;
    if(!response.ok)throw new Error('Could not verify the existing calendar invitation.');
    const event=await response.json();
    if(event.status==='cancelled')throw new Error('This invitation was cancelled. Review it in Calendar.');
    return {htmlLink:event.htmlLink??null,meetLink:event.hangoutLink??null};
  };
  if(eventId){const found=await existing();if(found)return found;}
  if(!Number.isFinite(Date.parse(opts.start)) || Date.parse(opts.start)<=Date.now() || Date.parse(opts.end)<=Date.parse(opts.start))throw new Error('Choose a future meeting time.');
  const availability=await fetch(`${CAL}/freeBusy`,{method:'POST',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({timeMin:opts.start,timeMax:opts.end,items:[{id:'primary'}]})});
  if(!availability.ok)throw new Error('Could not recheck calendar availability.');
  if(checkedBusy(await availability.json()).some(([a,b])=>a<Date.parse(opts.end)&&b>Date.parse(opts.start)))throw new Error('That time is no longer available.');
  const res = await fetch(`${CAL}/calendars/primary/events?sendUpdates=all&conferenceDataVersion=1`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      ...(eventId ? {id:eventId} : {}),
      summary: opts.summary,
      description: opts.description ?? "",
      start: { dateTime: opts.start, timeZone: opts.timeZone },
      end: { dateTime: opts.end, timeZone: opts.timeZone },
      attendees: [{ email: opts.attendee }],
      conferenceData: { createRequest: { requestId: eventId ?? `nw-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  if(res.status===409&&eventId){const found=await existing();if(found)return found;}
  if (!res.ok) throw new Error(`Calendar invite failed: ${res.status}`);
  const json = (await res.json()) as { htmlLink?: string; hangoutLink?: string };
  return { htmlLink: json.htmlLink ?? null, meetLink: json.hangoutLink ?? null };
}

/** HTTP 200 can still contain a per-calendar failure. Missing data is not availability. */
export function checkedBusy(value: unknown): Array<[number,number]> {
  const primary=(value as {calendars?:{primary?:{errors?:unknown[];busy?:Array<{start:string;end:string}>}}})?.calendars?.primary;
  if(!primary || primary.errors?.length || !Array.isArray(primary.busy))throw new Error('Could not check calendar availability. Reconnect Calendar or try again.');
  return primary.busy.map(item=>{const a=Date.parse(item.start),b=Date.parse(item.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)throw new Error('Calendar returned invalid availability.');return [a,b];});
}
