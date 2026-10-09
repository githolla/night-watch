import assert from "node:assert/strict";
import test from "node:test";
import { buildSendPlan, industryOf, roleOf, sizeOf, tally, type PlanClock, type PlanSeat } from "./send-plan.ts";

const seat = (extra: Partial<PlanSeat> = {}): PlanSeat => ({ autoSend: true, paused: false, postalAddressSet: true, skippedToday: false, sentToday: 0, dailyCap: 25, ...extra });
const time = (extra: Partial<PlanClock> = {}): PlanClock => ({ sendDay: true, minutesNow: 8 * 60, sendFrom: 9 * 60, sendUntil: 11 * 60 + 30, runEveryMinutes: 10, maxPerRun: 2, nextSendDayLabel: "Monday", todayLabel: "today", ...extra });
const queue = (n: number) => Array.from({ length: n }, (_, i) => ({ cardId: `c${i}`, held: null }));

test("before the window: today, in order, capped by the daily limit, the rest later", () => {
  const plan = buildSendPlan(queue(31), seat(), time());
  assert.equal(plan.when, "today");
  assert.equal(plan.going, 25);
  assert.equal(plan.later, 6);
  assert.equal(plan.slots.c0.label, "#1 · today about 9:00am");
  assert.match(plan.slots.c24.label, /^#25 · today about 11:2\dam$/);
  assert.equal(plan.slots.c25.label, "#26 · a later day (over the daily limit)");
});

test("what was already sent today counts against the limit", () => {
  assert.equal(buildSendPlan(queue(31), seat({ sentToday: 20 }), time()).going, 5);
});

test("the window's own capacity applies late in the morning", () => {
  const plan = buildSendPlan(queue(31), seat(), time({ minutesNow: 11 * 60 }));
  assert.equal(plan.going, 6, "three runs left, two each");
});

test("after the window, a skipped day or a weekend: the next send day, with a fresh limit", () => {
  for (const clock of [time({ minutesNow: 15 * 60 }), time({ sendDay: false })]) {
    const plan = buildSendPlan(queue(5), seat({ sentToday: 25 }), clock);
    assert.equal(plan.when, "next");
    assert.equal(plan.dayLabel, "Monday");
    assert.equal(plan.going, 5);
  }
  assert.equal(buildSendPlan(queue(5), seat({ skippedToday: true }), time()).when, "next");
});

test("held rows are counted apart and never given a slot to send", () => {
  const plan = buildSendPlan([{ cardId: "a", held: "the buyer left" }, ...queue(2)], seat(), time());
  assert.equal(plan.held, 1);
  assert.equal(plan.going, 2);
  assert.equal(plan.slots.a.label, "Held: the buyer left");
  assert.equal(plan.slots.c0.position, 1);
});

test("off or paused still shows the plan, with the reason", () => {
  assert.equal(buildSendPlan(queue(3), seat({ autoSend: false }), time()).blocker, "Auto-send is off");
  assert.equal(buildSendPlan(queue(3), seat({ paused: true }), time()).blocker, "Auto-send is paused");
});

test("industries, roles and sizes read plainly", () => {
  assert.equal(industryOf("pest control, cleaning, restoration and other commercial or home services"), "Pest control");
  assert.equal(industryOf("Commercial landscaping"), "Landscaping and tree care");
  assert.equal(industryOf("state-licensed cannabis cultivators, processors and dispensary groups"), "Cannabis");
  assert.equal(industryOf(null), "Other");
  assert.equal(industryOf("Operating business", "Pacific Coast Termite"), "Pest control");
  assert.equal(industryOf("Operating business", "Cleggs"), "Other");
  assert.equal(roleOf("Owner and President"), "Owners and founders");
  assert.equal(roleOf("President & CEO"), "CEOs and presidents");
  assert.equal(roleOf("Vice President of Operations"), "Operations leaders");
  assert.equal(roleOf("CFO"), "Other leaders");
  assert.equal(sizeOf({ usdMillions: 18 }), "$10M to $25M");
  assert.equal(sizeOf({ usdMillions: 18, status: "estimated", employees: 120 }), "50 to 300 employees");
  assert.deepEqual(tally(["b", "a", "b"]), [{ label: "b", count: 2 }, { label: "a", count: 1 }]);
});
