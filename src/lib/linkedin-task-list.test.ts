import assert from "node:assert/strict";
import test from "node:test";
import { buildLinkedInTasks, type FirstMessageRow, type FollowupStepRow } from "./linkedin-task-list.ts";

const now = Date.parse("2026-10-11T15:00:00Z");
const person = (name: string, extra: Partial<NonNullable<FirstMessageRow["people"]>> = {}) => ({ full_name: name, title: "CEO", linkedin_url: `linkedin.com/in/${name.toLowerCase()}`, do_not_contact: false, ...extra });
const card = (id: string, extra: Partial<FirstMessageRow> = {}): FirstMessageRow => ({
  id, person_id: `p-${id}`, updated_at: "2026-10-09T12:00:00Z", channel: "linkedin_first", status: "new",
  linkedin_subject: null, linkedin_message: `Hi from ${id}`, people: person(id), accounts: { name: `Co ${id}`, domain: `co-${id}.com` }, ...extra,
});
const step = (id: string, cardId: string, extra: Partial<FollowupStepRow> = {}): FollowupStepRow => ({
  id, step_number: 1, channel: "linkedin_message", status: "pending", scheduled_at: "2026-10-10T14:00:00Z", sent_at: null, error: null, subject: null, body: `Following up ${id}`,
  cadences: { card_id: cardId, person_id: `p-${cardId}`, owner: "suuchi", status: "active", people: person(cardId), cards: { accounts: { name: `Co ${cardId}`, domain: `co-${cardId}.com` } } },
  ...extra,
});

test("due follow-ups come first, then first messages, each oldest first", () => {
  const cards = [card("b", { updated_at: "2026-10-10T00:00:00Z" }), card("a", { updated_at: "2026-10-08T00:00:00Z" })];
  const steps = [step("s2", "x", { scheduled_at: "2026-10-11T09:00:00Z" }), step("s1", "y", { scheduled_at: "2026-10-09T09:00:00Z" })];
  assert.deepEqual(buildLinkedInTasks(cards, new Set(), steps, now).map((task) => task.key), ["step:s1", "step:s2", "card:a", "card:b"]);
});

test("leaves out what is not a LinkedIn send waiting on a person now", () => {
  const cards = [
    card("email", { channel: "email_first" }), card("sent", { status: "sent" }), card("blank", { linkedin_message: "  " }),
    card("optout", { people: person("optout", { do_not_contact: true }) }), card("touched"), card("followed"), card("ok"),
  ];
  const steps = [
    step("later", "l1", { scheduled_at: "2026-10-12T09:00:00Z" }), step("mail", "l2", { channel: "email" }), step("done", "l3", { status: "sent" }),
    step("stopped", "l4", { cadences: { ...step("x", "l4").cadences!, status: "stopped" } }), step("going", "l5", { sent_at: "2026-10-11T14:00:00Z" }),
    step("due", "followed"),
  ];
  const keys = buildLinkedInTasks(cards, new Set(["touched"]), steps, now).map((task) => task.key);
  assert.deepEqual(keys, ["step:due", "card:ok"]);
});

test("a step left half-recorded can still be marked sent, and profile links get a scheme", () => {
  const [task] = buildLinkedInTasks([], new Set(), [step("half", "c", { sent_at: "2026-10-11T10:00:00Z", error: "Manual activity pending" })], now);
  assert.equal(task.stepId, "half");
  assert.equal(task.profileUrl, "https://linkedin.com/in/c");
  assert.equal(buildLinkedInTasks([card("n", { people: person("n", { linkedin_url: null }) })], new Set(), [], now)[0].profileUrl, null);
});
