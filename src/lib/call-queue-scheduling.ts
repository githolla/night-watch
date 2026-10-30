import type { CallTask } from "./call-tasks.ts";
import { nextVoiceCallAt } from "./voice-policy.ts";
import { localParts } from "./local-time.ts";

export function balancedCallTasks(tasks: CallTask[]) {
  const josh = tasks.filter(task => task.owner === "josh");
  const suuchi = tasks.filter(task => task.owner === "suuchi");
  return Array.from({ length: Math.max(josh.length, suuchi.length) }, (_, index) => [josh[index], suuchi[index]].filter((task): task is CallTask => Boolean(task))).flat();
}

export function catchupCallAt(originalDue: string, timezone: string, position: number, now = new Date()) {
  if (Date.parse(originalDue) >= now.getTime()) return originalDue;
  const local = localParts(now, timezone);
  const todayAtTen = nextVoiceCallAt(new Date(now.getTime() - 86_400_000).toISOString(), timezone, 1);
  const start = Date.parse(todayAtTen) > now.getTime() ? Date.parse(todayAtTen)
    : !["Sat", "Sun"].includes(local.weekday) && local.minutes < 16 * 60 ? now.getTime() + 120_000
    : Date.parse(nextVoiceCallAt(now.toISOString(), timezone, 1));
  return new Date(start + position * 60_000).toISOString();
}

export function nextCapacitySlot(earliest: string, timezone: string, counts: ReadonlyMap<string, number>, dailyLimit: number) {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1) throw new Error("A positive calling limit is required.");
  let candidate = earliest;
  for (let day = 0; day < 366; day++) {
    const date = localParts(new Date(candidate), "America/New_York").date;
    if ((counts.get(date) ?? 0) < dailyLimit) return candidate;
    candidate = nextVoiceCallAt(candidate, timezone, 1);
  }
  throw new Error("No calling capacity is available in the planning window.");
}
