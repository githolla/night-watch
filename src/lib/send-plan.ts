/**
 * What the morning auto-send will do next, in plain terms: when, how many, in what order, and what kinds of
 * companies and people. Pure, so the Drafts page and the Reach-out list bar say exactly the same thing. The
 * order itself comes from the morning run's own queue (autoSendQueue); this only lays it out.
 */

export type PlanSeat = { autoSend: boolean; paused: boolean; postalAddressSet: boolean; skippedToday: boolean; sentToday: number; dailyCap: number };
export type PlanClock = { sendDay: boolean; minutesNow: number; sendFrom: number; sendUntil: number; runEveryMinutes: number; maxPerRun: number; nextSendDayLabel: string; todayLabel: string };
export type PlanEntry = { cardId: string; held: string | null };
export type PlanSlot = { position: number; label: string; today: boolean };
export type SendPlan = {
  /** "today" when the window is still ahead today; otherwise the next send day. */
  when: "today" | "next";
  dayLabel: string;
  windowLabel: string;
  /** Emails that go in that window, after the daily limit and the window's capacity. */
  going: number;
  /** Ready but past that window's capacity or the daily limit; they go on later days. */
  later: number;
  /** Held back on purpose: no usable address, or the buyer is not confirmed for this list row. */
  held: number;
  /** Why auto-send is not running, when it is not; the plan then shows what would happen. */
  blocker: string | null;
  slots: Record<string, PlanSlot>;
};

const clock = (minutes: number) => {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
};

export function buildSendPlan(queue: PlanEntry[], seat: PlanSeat, time: PlanClock): SendPlan {
  const blocker = !seat.autoSend ? "Auto-send is off" : seat.paused ? "Auto-send is paused" : !seat.postalAddressSet ? "No postal address is set" : null;
  const todayAhead = time.sendDay && !seat.skippedToday && time.minutesNow < time.sendUntil;
  const when: SendPlan["when"] = todayAhead ? "today" : "next";
  const start = todayAhead ? Math.max(time.minutesNow, time.sendFrom) : time.sendFrom;
  // The run fires every few minutes and sends at most a couple each time, so the window has a ceiling too.
  const runs = Math.max(0, Math.floor((time.sendUntil - start) / time.runEveryMinutes));
  const windowCapacity = runs * time.maxPerRun;
  const capLeft = Math.max(0, seat.dailyCap - (todayAhead ? seat.sentToday : 0));
  const sendable = queue.filter((entry) => !entry.held);
  const going = Math.min(sendable.length, capLeft, windowCapacity);
  const spacing = going > 0 ? (time.sendUntil - start) / going : 0;
  const dayLabel = todayAhead ? time.todayLabel : time.nextSendDayLabel;
  const slots: Record<string, PlanSlot> = {};
  sendable.forEach((entry, index) => {
    slots[entry.cardId] = index < going
      ? { position: index + 1, today: todayAhead, label: `#${index + 1} · ${dayLabel} about ${clock(start + spacing * index)}` }
      : { position: index + 1, today: false, label: `#${index + 1} · a later day (over the daily limit)` };
  });
  for (const entry of queue) if (entry.held) slots[entry.cardId] = { position: 0, today: false, label: `Held: ${entry.held}` };
  return { when, dayLabel, windowLabel: `${clock(start)} to ${clock(time.sendUntil)}`, going, later: sendable.length - going, held: queue.length - sendable.length, blocker, slots };
}

/** Short industry names for the breakdown, from a list row's sector text. */
const INDUSTRIES: Array<[RegExp, string]> = [
  [/cannabis|dispensar/i, "Cannabis"],
  [/pest|extermin|termite/i, "Pest control"],
  [/landscap|lawn|grounds|tree care|vegetation|nursery|arbor/i, "Landscaping and tree care"],
  [/roof/i, "Roofing"],
  [/hvac|plumb|electric|heating|cooling|mechanical/i, "HVAC, plumbing and electrical"],
  [/fire protection|sprinkler/i, "Fire protection"],
  [/solar|battery/i, "Solar"],
  [/collision|auto body/i, "Collision repair"],
  [/automotive|dealer|auto parts/i, "Automotive"],
  [/customs|freight forward/i, "Customs and freight"],
  [/truck|logistic|warehous|freight|transport|moving|storage/i, "Trucking and logistics"],
  [/home health|hospice|medical equipment|dental|veterinar|physical therapy|health/i, "Healthcare"],
  [/restaurant|franchise|food service/i, "Restaurants"],
  [/food|beverage|bakery|brew|meat|packing/i, "Food and beverage"],
  [/distribut|wholesale|supply|suppliers/i, "Distribution"],
  [/manufactur|machin|fabricat|industrial|stamping|plastics|print|packag/i, "Manufacturing"],
  [/clean|janitor|restoration|services/i, "Home and commercial services"],
  [/construct|contractor|builder|remodel/i, "Construction"],
  [/rental|waste|environmental|security|alarm|property management/i, "Other services"],
];
export function industryOf(sector: string | null | undefined, company?: string | null): string {
  const match = (text: string) => INDUSTRIES.find(([pattern]) => pattern.test(text))?.[1];
  // Older lists only say "Operating business"; the company's own name often still says what it does.
  return match(sector ?? "") ?? match(company ?? "") ?? "Other";
}

/** Who the email goes to, by title. */
export function roleOf(title: string | null | undefined): string {
  const text = title ?? "";
  if (/\b(owner|founder|co-founder|principal|partner)\b/i.test(text)) return "Owners and founders";
  if (/\b(ceo|chief executive|president)\b/i.test(text) && !/vice[ -]president|\bvp\b/i.test(text)) return "CEOs and presidents";
  if (/\b(coo|chief operating|operations|general manager)\b/i.test(text)) return "Operations leaders";
  return "Other leaders";
}

/** Company size band, from a reported figure or a headcount. */
export function sizeOf(revenue: { usdMillions?: number | null; status?: string | null; employees?: number | null } | null | undefined): string {
  if (!revenue) return "Size not known";
  if (revenue.status === "estimated" && typeof revenue.employees === "number") return "50 to 300 employees";
  const value = revenue.usdMillions;
  if (typeof value !== "number") return "Size not known";
  if (value < 25) return "$10M to $25M";
  if (value <= 50) return "$25M to $50M";
  return "Over $50M";
}

/** Counts per label, largest first. */
export function tally(labels: string[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
